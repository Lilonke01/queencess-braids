
// Hosted reviewer API. The local Node server uses a separate database and accepts ordinary contact input.
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
  AND id!=? AND starts<? AND starts+duration>?`;
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
    const {phone,area,style,date,time}=await body(request);
    const duration=durations.get(style);
    if(!/^\+270000000(0[1-9]|[1-9][0-9])$/.test(phone) ||
       !["Demo Area A","Demo Area B","Demo Area C"].includes(area) || !slot(date,time,duration)) {
      return fail("Choose the supplied fictional client and area, a service, and a future appointment time.",400);
    }
    // The public demo accepts only preset phone numbers and areas, and derives the fictional name.
    const id=crypto.randomUUID(), starts=minutes(time);
    const name="Demo Client "+phone.slice(-2);
    const booking=await sql(`INSERT INTO bookings (id,style,area,date,time,starts,duration,clientName,clientPhone,createdAt)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (${overlap})
      AND NOT EXISTS (SELECT 1 FROM bookings WHERE clientPhone=? AND style=? AND date=? AND time=? AND status='Pending')
      RETURNING id,status`,id,style,area,date,time,starts,duration,name,phone,new Date().toISOString(),
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
    const {results:bookings}=await sql("SELECT * FROM bookings ORDER BY (status IN ('Accepted','Pending')) DESC, createdAt DESC").all();
    return json({bookings});
  }
  if(path==="/api/owner/reports/monthly" && method==="GET") {
    const month=query.get("month") || new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Johannesburg"}).format().slice(0,7);
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail("Enter a month in YYYY-MM format.",400);
    const limits=[month+"-01",month+"-31"];
    const {results:rows}=await sql("SELECT style,status,count(*) AS count FROM bookings WHERE date BETWEEN ? AND ? GROUP BY status,style ORDER BY style",...limits).all();
    const totals=Object.fromEntries(states.map(status=>[status,0]));
    const completedByService=[];
    for(const {style,status,count} of rows) {
      totals[status]+=count;
      if(status==="Completed") completedByService.push({style,count});
    }
    // The normalized fictional phone identifies a returning client across multiple visits.
    const {uniqueClients}=await sql("SELECT count(DISTINCT clientPhone) AS uniqueClients FROM bookings WHERE status='Completed' AND date BETWEEN ? AND ?",...limits).first();
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
// Cap request bytes while streaming, before parsing or allocating a large JSON body.
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
