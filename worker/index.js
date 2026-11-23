
// Customer bookings and owner-only management use persistent D1 data and R2 photo storage.
const durations = new Map([["Knotless braids",180],["Feed-in cornrows",120],["Boho braids",240],["Lashes",90]]);
const reserved = "('Accepted','Completed','No-show')";
const states = ["Pending","Accepted","Declined","Completed","Cancelled","No-show"];
const open = ["Pending","Accepted"];
const json = (data, status = 200) => Response.json(data, {status, headers: {"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const fail = (error, status) => json({error},status);
const startsAt = (date,time) => Date.parse(date+"T"+time+":00+02:00");
const minutes = time => Number(time.slice(0,2))*60+Number(time.slice(3));
function slot(date,time,duration) {
  return duration && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0,10)===date && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) &&
    minutes(time)+duration<=1440 && startsAt(date,time)>Date.now();
}
// The overlap query runs inside INSERT or UPDATE, so availability and the write happen atomically in D1.
const overlap = `SELECT 1 FROM bookings WHERE date=? AND status IN ${reserved}
  AND clientPhone NOT GLOB '+270000000*' AND id!=? AND starts<? AND starts+duration>?`;
async function api(request,env,url) {
  const db=env.DB;
  const {pathname:path,searchParams:query}=url;
  const {method}=request;
  const sql=(query,...args)=>db.prepare(query).bind(...args);
  const available=async (date,time,duration,id="") => slot(date,time,duration) &&
    !(await sql(overlap,date,id,minutes(time)+duration,minutes(time)).first());
  if(path==="/api/health" && method==="GET") {
    await sql("SELECT id FROM bookings LIMIT 1").first();
    return json({status:"ok"});
  }
  if(path==="/api/availability" && method==="GET") {
    return json({available:Boolean(await available(query.get("date"),query.get("time"),durations.get(query.get("style"))))});
  }
  if(path==="/api/content" && method==="GET") return json(await siteContent(sql));
  const photoPath=path.match(/^\/api\/photos\/([a-f0-9-]{36})$/);
  if(photoPath && (method==="GET" || method==="HEAD")) {
    const photo=await sql("SELECT mime FROM photos WHERE id=?",photoPath[1]).first();
    if(!photo) return fail("Photo not found.",404);
    const object=await env.BUCKET.get(photoPath[1]);
    if(!object) return fail("Photo not found.",404);
    return new Response(method==="HEAD"?null:object.body,{headers:{"Content-Type":photo.mime,"Cache-Control":"public, max-age=300","X-Content-Type-Options":"nosniff"}});
  }
  if (path === "/api/reviews" && method === "GET") {
    const { results: reviews } = await sql("SELECT id,rating,comment,createdAt,displayName FROM reviews WHERE status='Published' ORDER BY createdAt DESC LIMIT 50").all();
    return json({ reviews });
  }
  if (path === "/api/reviews" && method === "POST") {
    const { rating, comment: rawComment, displayName: rawName } = await body(request);
    const displayName = typeof rawName === "string" ? rawName.trim() : "";
    if (displayName.length > 40) return fail("Use a display name of up to 40 characters.", 400);
    const comment = typeof rawComment === "string" ? rawComment.trim() : "";
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length < 10 || comment.length > 500) {
      return fail("Choose a rating and enter a review of 10 to 500 characters.", 400);
    }
    await sql("INSERT INTO reviews (id,rating,comment,createdAt,displayName) VALUES (?,?,?,?,?)",
      crypto.randomUUID(), rating, comment, new Date().toISOString(), displayName).run();
    return json({ status: "Pending" }, 201);
  }
  if(path==="/api/bookings" && method==="POST") {
    const input=await body(request);
    const name=typeof input.name==="string"?input.name.trim():"";
    const area=typeof input.area==="string"?input.area.trim():"";
    let phone=typeof input.phone==="string"?input.phone.replace(/[\s()-]/g,""):"";
    if(/^0\d{9}$/.test(phone)) phone="+27"+phone.slice(1);
    if(/^27\d{9}$/.test(phone)) phone="+"+phone;
    const {style,date,time}=input;
    const mapLink=typeof input.mapLink==="string"?input.mapLink.trim():"";
    const duration=durations.get(style);
    if(name.length<2 || name.length>100 || !/^\+[1-9]\d{7,14}$/.test(phone) || /^\+270000000/.test(phone) ||
       area.length<2 || area.length>120 || !slot(date,time,duration) || !safeMap(mapLink)) {
      return fail("Enter your full name, a valid phone number, your area, a service and a future appointment time. Use a Google Maps link if adding a location.",400);
    }
    const id=crypto.randomUUID(), starts=minutes(time);
    const booking=await sql(`INSERT INTO bookings (id,style,area,date,time,starts,duration,clientName,clientPhone,createdAt,mapLink)
      SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (${overlap})
      AND NOT EXISTS (SELECT 1 FROM bookings WHERE clientPhone=? AND style=? AND date=? AND time=? AND status='Pending')
      RETURNING id,status`,id,style,area,date,time,starts,duration,name,phone,new Date().toISOString(),mapLink,
      date,id,starts+duration,starts,phone,style,date,time).first();
    return booking?json(booking,201):fail("This time is unavailable or you already requested it.",409);
  }
  const reference=path.match(/^\/api\/bookings\/([a-f0-9-]{36})$/);
  if(reference && method==="GET") {
    const booking=await sql("SELECT id,status,date,time FROM bookings WHERE id=?",reference[1]).first();
    return booking?json(booking):fail("Booking not found.",404);
  }
  if(!path.startsWith("/api/owner/")) return fail("Endpoint not found.",404);
  const now=Date.now();
  if(path==="/api/owner/login" && method==="POST") {
    if(!env.OWNER_PASSWORD || env.OWNER_PASSWORD.length<16) return fail("Owner login is not configured.",503);
    const {username,password}=await body(request);
    const bucket=Math.floor(now/900000);
    const address=await hash(request.headers.get("cf-connecting-ip") || "shared");
    await sql("DELETE FROM login_attempts WHERE bucket<?",bucket).run();
    const attempt=await sql(`INSERT INTO login_attempts (address,bucket,count) VALUES (?,?,1)
      ON CONFLICT(address,bucket) DO UPDATE SET count=count+1 RETURNING count`,address,bucket).first();
    if(attempt.count>20) return fail("Too many attempts. Try again in 15 minutes.",429);
    if(username!==(env.OWNER_USERNAME||"owner") || typeof password!=="string" || await hash(password)!==await hash(env.OWNER_PASSWORD)) {
      return fail("Incorrect username or password.",401);
    }
    // Store only a hash of the session token in D1 so it works across Worker instances.
    const token=crypto.randomUUID();
    await sql("DELETE FROM sessions WHERE expires<=?",now).run();
    await sql("INSERT INTO sessions (token,expires) VALUES (?,?)",await hash(token),now+28800000).run();
    return json({token});
  }
  const token=request.headers.get("authorization")?.match(/^Bearer ([a-f0-9-]{36})$/)?.[1];
  const tokenHash=token && await hash(token);
  if(!tokenHash || !(await sql("SELECT 1 FROM sessions WHERE token=? AND expires>?",tokenHash,now).first())) {
    return fail("Sign in to the owner account.",401);
  }
  if(path==="/api/owner/logout" && method==="POST") {
    await sql("DELETE FROM sessions WHERE token=?",tokenHash).run();
    return json({signedOut:true});
  }
  if(path==="/api/owner/content" && method==="GET") return json(await siteContent(sql));
  if(path==="/api/owner/content" && method==="PUT") {
    const input=await body(request), content={};
    for(const [field,max] of Object.entries({headline:120,intro:1200,announcement:400,portfolioTitle:100})) {
      if(typeof input[field]!=="string" || input[field].length>max || (field!=="announcement" && !input[field].trim())) return fail("Complete the website text within the shown limits.",400);
      content[field]=input[field].trim();
    }
    if(typeof input.showOriginalPhotos!=="boolean") return fail("Choose whether to show the original portfolio photos.",400);
    content.showOriginalPhotos=input.showOriginalPhotos;
    content.heroPhoto=typeof input.heroPhoto==="string"?input.heroPhoto:"";
    if(content.heroPhoto && !(await sql("SELECT id FROM photos WHERE id=?",content.heroPhoto).first())) return fail("Choose an uploaded cover photo.",400);
    await sql("INSERT INTO site_content(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",JSON.stringify(content)).run();
    return json({saved:true});
  }
  if(path==="/api/owner/photos" && method==="POST") {
    const mime=request.headers.get("content-type")?.split(";")[0];
    if(!["image/jpeg","image/png","image/webp"].includes(mime)) return fail("Upload a JPEG, PNG or WebP image.",400);
    const {count}=await sql("SELECT count(*) AS count FROM photos").first();
    if(count>=100) return fail("The gallery holds up to 100 photos. Remove an older photo first.",400);
    const bytes=await readBytes(request,4*1024*1024);
    const valid=mime==="image/jpeg"?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:
      mime==="image/png"?[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v):
      new TextDecoder().decode(bytes.slice(0,4))==="RIFF"&&new TextDecoder().decode(bytes.slice(8,12))==="WEBP";
    if(!valid) return fail("This file is not a supported image.",400);
    const caption=query.get("caption")?.trim();
    if(!caption || caption.length>180) return fail("Add a caption of up to 180 characters.",400);
    const id=crypto.randomUUID();
    await env.BUCKET.put(id,bytes,{httpMetadata:{contentType:mime}});
    try {await sql("INSERT INTO photos(id,caption,mime,createdAt) VALUES(?,?,?,?)",id,caption,mime,new Date().toISOString()).run();}
    catch(error) {await env.BUCKET.delete(id); throw error;}
    return json({id},201);
  }
  const ownerPhoto=path.match(/^\/api\/owner\/photos\/([a-f0-9-]{36})$/);
  if(ownerPhoto && method==="PATCH") {
    const {caption}=await body(request);
    if(typeof caption!=="string" || !caption.trim() || caption.trim().length>180) return fail("Add a caption of up to 180 characters.",400);
    const photo=await sql("UPDATE photos SET caption=? WHERE id=? RETURNING id",caption.trim(),ownerPhoto[1]).first();
    return photo?json({saved:true}):fail("Photo not found.",404);
  }
  if(ownerPhoto && method==="DELETE") {
    await sql("DELETE FROM photos WHERE id=?",ownerPhoto[1]).run();
    await env.BUCKET.delete(ownerPhoto[1]);
    return json({removed:true});
  }
  if (path === "/api/owner/reviews" && method === "GET") {
    const { results: reviews } = await sql("SELECT * FROM reviews WHERE status!='Hidden' ORDER BY (status='Pending') DESC, createdAt DESC LIMIT 100").all();
    return json({ reviews });
  }
  const reviewMatch = path.match(/^\/api\/owner\/reviews\/([a-f0-9-]{36})$/);
  if (reviewMatch && method === "PATCH") {
    const { status } = await body(request);
    if (!["Published", "Hidden"].includes(status)) return fail("Choose Publish or Hide.", 400);
    const review = await sql("UPDATE reviews SET status=? WHERE id=? RETURNING id,status", status, reviewMatch[1]).first();
    return review ? json({ review }) : fail("Review not found.", 404);
  }
  if(path==="/api/owner/bookings" && method==="GET") {
    const {results:bookings}=await sql("SELECT * FROM bookings WHERE clientPhone NOT GLOB '+270000000*' ORDER BY (status IN ('Accepted','Pending')) DESC, createdAt DESC").all();
    return json({bookings});
  }
  if(path==="/api/owner/reports/monthly" && method==="GET") {
    const month=query.get("month") || new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Johannesburg"}).format().slice(0,7);
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail("Enter a month in YYYY-MM format.",400);
    const limits=[month+"-01",month+"-31"];
    const {results:rows}=await sql("SELECT style,status,count(*) AS count FROM bookings WHERE date BETWEEN ? AND ? AND clientPhone NOT GLOB '+270000000*' GROUP BY status,style ORDER BY style",...limits).all();
    const totals=Object.fromEntries(states.map(status=>[status,0]));
    const completedByService=[];
    for(const {style,status,count} of rows) {
      totals[status]+=count;
      if(status==="Completed") completedByService.push({style,count});
    }
    const {uniqueClients}=await sql("SELECT count(DISTINCT clientPhone) AS uniqueClients FROM bookings WHERE status='Completed' AND date BETWEEN ? AND ? AND clientPhone NOT GLOB '+270000000*'",...limits).first();
    return json({month,totals,completedByService,uniqueClients,completedWithoutClient:0});
  }
  const match=path.match(/^\/api\/owner\/bookings\/([a-f0-9-]{36})$/);
  if(!match || method!=="PATCH") return fail("Endpoint not found.",404);
  const id=match[1];
  const input=await body(request);
  const booking=await sql("SELECT * FROM bookings WHERE id=?",id).first();
  if(!booking) return fail("Booking not found.",404);
  const changed=await update(sql,booking,input);
  return changed instanceof Response?changed:json({booking:changed});
}
async function update(sql,booking,input) {
  const {id,status:previous,date,time,duration}=booking;
  const rescheduling=input.action==="reschedule";
  let status=input.status, newDate=date, newTime=time;
  if(rescheduling) {
    status=previous;
    newDate=input.date;
    newTime=input.time;
    if(!open.includes(previous)) return fail("Only open bookings can be rescheduled.",409);
    if(!slot(newDate,newTime,duration)) return fail("Choose a future appointment time.",400);
  } else {
    if(!states.slice(1).includes(status)) return fail("Choose a valid booking action.",400);
    if(status===previous) return booking;
    const allowed=status==="Cancelled"?open.includes(previous)
      : ["Accepted","Declined"].includes(status)?previous==="Pending"
      : previous==="Accepted" && startsAt(date,time)<=Date.now();
    if(!allowed || (status==="Accepted" && !slot(date,time,duration))) return fail("This booking cannot move to that status.",409);
  }
  const starts=minutes(newTime);
  const checkSlot=rescheduling||status==="Accepted";
  // Match the original booking state to avoid overwriting a concurrent owner decision or reschedule.
  const result=await sql(`UPDATE bookings SET status=?,date=?,time=?,starts=?
    WHERE id=? AND status=? AND date=? AND time=? ${checkSlot?`AND NOT EXISTS (${overlap})`:""}
    RETURNING *`,status,newDate,newTime,starts,id,previous,date,time,
    ...(checkSlot?[newDate,id,starts+duration,starts]:[])).first();
  return result ?? fail("That time overlaps another appointment or the booking changed. Refresh and try again.",409);
}
function safeMap(link) {
  if(!link) return true;
  if(link.length>2000) return false;
  try {
    const u=new URL(link);
    return u.protocol==="https:" && !u.username && !u.password &&
      (["maps.app.goo.gl","goo.gl","maps.google.com","www.google.com","google.com"].includes(u.hostname));
  } catch { return false; }
}
async function siteContent(sql) {
  const defaults={headline:"Queen look and princess treatment",intro:"Braids and lashes, at your place in Plettenberg Bay and surrounding areas. Choose a braid style or a lash appointment and request a visit from Queencess Braids.",announcement:"",portfolioTitle:"Braiding portfolio",showOriginalPhotos:true,heroPhoto:""};
  const row=await sql("SELECT value FROM site_content WHERE id=1").first();
  const {results:photos}=await sql("SELECT id,caption FROM photos ORDER BY createdAt DESC,id DESC").all();
  return {content:{...defaults,...(row?JSON.parse(row.value):{})},photos};
}
// Bound both JSON and photo uploads while streaming, before allocating the final body.
async function readBytes(request,limit) {
  const reader=request.body?.getReader();
  if(!reader) throw fail("Send a request body.",400);
  const chunks=[]; let size=0;
  for(;;) {
    const {value,done}=await reader.read();
    if(done) break;
    size+=value.byteLength;
    if(size>limit) {await reader.cancel();throw fail("File or request is too large.",413);}
    chunks.push(value);
  }
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return bytes;
}
async function body(request) {
  const reader=request.body?.getReader();
  if(!reader) throw fail("Send a JSON object.",400);
  const decoder=new TextDecoder();
  let size=0,text="";
  for(;;) {
    const {value,done}=await reader.read();
    if(done) break;
    size+=value.byteLength;
    if(size>8192) {
      await reader.cancel();
      throw fail("Request is too large.",413);
    }
    text+=decoder.decode(value,{stream:true});
  }
  try {
    const result=JSON.parse(text+decoder.decode());
    if(result && typeof result==="object" && !Array.isArray(result)) return result;
  } catch {}
  throw fail("Send a JSON object.",400);
}
async function hash(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),
    byte=>byte.toString(16).padStart(2,"0")).join("");
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(url.pathname.startsWith("/api/")) {
      try { return await api(request,env,url); }
      catch(error) {
        if(error instanceof Response) return error;
        console.error(error);
        return fail("Booking service is unavailable.",500);
      }
    }
    // The build embeds the sanitized public assets. Only exact paths in that manifest are served.
    const path=url.pathname==="/"?"/index.html":url.pathname;
    const asset=Object.hasOwn(ASSETS,path)?ASSETS[path]:null;
    if(!asset) return new Response("Not found",{status:404});
    return new Response(request.method==="HEAD"?null:Uint8Array.from(atob(asset.data),value=>value.charCodeAt(0)), {
      headers: {"Content-Type":asset.type,"X-Content-Type-Options":"nosniff"}
    });
  }
};
