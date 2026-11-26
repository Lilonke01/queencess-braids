import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker, {sendOwnerPush,validPushEndpoint} from "../worker/index.js";

test("owner-only push subscriptions, signed delivery and booking failure isolation",async t=>{
  const sqlite=new DatabaseSync(":memory:");
  const journal=JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json",import.meta.url)));
  for(const {tag} of journal.entries) sqlite.exec(readFileSync(new URL(`../drizzle/${tag}.sql`,import.meta.url),"utf8"));
  const DB={prepare(query){return {bind(...args){const stmt=sqlite.prepare(query);return {
    first:async()=>stmt.get(...args)??null,all:async()=>({results:stmt.all(...args)}),run:async()=>stmt.run(...args),
  };}};}};
  const keys=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
  const raw=new Uint8Array(await crypto.subtle.exportKey("raw",keys.publicKey));
  const env={DB,OWNER_USERNAME:"test-owner",OWNER_PASSWORD:"local-test-only-not-production",PUSH_PRIVATE_JWK:JSON.stringify(await crypto.subtle.exportKey("jwk",keys.privateKey)),PUSH_PUBLIC_KEY:Buffer.from(raw).toString("base64url")};
  async function call(path,{method="GET",data,token}={},context){return worker.fetch(new Request("https://test.invalid/api"+path,{method,headers:{...(token?{Authorization:"Bearer "+token}:{}),...(data?{"Content-Type":"application/json"}:{})},...(data?{body:JSON.stringify(data)}:{})}),env,context);}
  try {
    for(const endpoint of ["http://fcm.googleapis.com/token","https://127.0.0.1/token","https://fcm.googleapis.com.evil.example/token","https://user:pass@fcm.googleapis.com/token","https://fcm.googleapis.com:444/token"]) assert.equal(validPushEndpoint(endpoint),false);
    assert.equal(validPushEndpoint("https://fcm.googleapis.com/fcm/send/test-device"),true);
    assert.equal((await call("/owner/push")).status,401);
    assert.equal((await call("/owner/push",{method:"POST",data:{endpoint:"https://fcm.googleapis.com/fcm/send/test"}})).status,401);
    const {token}=await(await call("/owner/login",{method:"POST",data:{username:env.OWNER_USERNAME,password:env.OWNER_PASSWORD}})).json();
    assert.equal((await call("/owner/push",{method:"POST",token,data:{endpoint:"https://internal.example/a"}})).status,400);
    const registered=await call("/owner/push",{method:"POST",token,data:{endpoint:"https://fcm.googleapis.com/fcm/send/test-device"}});
    assert.equal(registered.status,201);const {id}=await registered.json();
    const config=await(await call("/owner/push",{token})).json();
    assert.equal(config.configured,true);assert.equal(config.devices.length,1);assert.equal(config.devices[0].endpoint,undefined);
    const response=await sendOwnerPush(DB,env,id,async(endpoint,options)=>{
      assert.equal(endpoint,"https://fcm.googleapis.com/fcm/send/test-device");assert.equal(options.method,"POST");assert.equal(options.body,undefined);
      const match=options.headers.Authorization.match(/^vapid t=(.*), k=(.*)$/);assert(match);assert.equal(match[2],env.PUSH_PUBLIC_KEY);
      const [header,payload,signature]=match[1].split(".");
      const claims=JSON.parse(Buffer.from(payload,"base64url"));assert.equal(claims.aud,"https://fcm.googleapis.com");assert(claims.exp>Date.now()/1000);
      assert(await crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},keys.publicKey,Buffer.from(signature,"base64url"),new TextEncoder().encode(header+"."+payload)));
      return new Response(null,{status:201});
    });
    assert.equal(response.accepted,1);
    assert(sqlite.prepare("SELECT lastAcceptedAt FROM owner_push_subscriptions WHERE id=?").get(id).lastAcceptedAt);
    let attempts=0;
    t.mock.method(globalThis,"fetch",async()=>{attempts++;throw Error("Simulated provider outage");});
    const tasks=[];
    const booking=await call("/bookings",{method:"POST",data:{name:"Push Test Customer",phone:"0821234567",area:"Plettenberg Bay",style:"Lashes",date:"2050-03-15",time:"10:00"}},{waitUntil(promise){tasks.push(promise);}});
    assert.equal(booking.status,201);await Promise.all(tasks);assert.equal(attempts,1);
    assert.equal(sqlite.prepare("SELECT count(*) AS count FROM bookings").get().count,1,"Push failure does not discard the booking");
    assert(sqlite.prepare("SELECT lastError FROM owner_push_subscriptions WHERE id=?").get(id).lastError);
    t.mock.restoreAll();
    assert.equal((await sendOwnerPush(DB,env,id,async()=>new Response(null,{status:410}))).accepted,0);
    assert.equal(sqlite.prepare("SELECT count(*) AS count FROM owner_push_subscriptions").get().count,0,"Expired devices are removed");
    await call("/owner/push",{method:"POST",token,data:{endpoint:"https://fcm.googleapis.com/fcm/send/test-device"}});
    assert.equal((await call("/owner/push",{method:"DELETE",token,data:{id}})).status,200);
    assert.equal(sqlite.prepare("SELECT count(*) AS count FROM owner_push_subscriptions").get().count,0);
  } finally {t.mock.restoreAll();sqlite.close();}
});
