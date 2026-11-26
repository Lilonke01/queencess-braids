import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../worker/index.js";

test("real booking, private owner management and persistent content/photo lifecycle", async () => {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of ["0000_booking", "0001_reviews", "0002_review_display_name", "0003_live_content", "0004_owner_push"]) {
    sqlite.exec(readFileSync(new URL(`../drizzle/${migration}.sql`, import.meta.url), "utf8"));
  }
  const files = new Map();
  const env = {
    OWNER_USERNAME: "test-owner", OWNER_PASSWORD: "test-only-password-not-production",
    DB: { prepare(query) {
      return { bind(...args) {
        const statement = sqlite.prepare(query);
        return {
          first: async () => statement.get(...args) ?? null,
          all: async () => ({ results: statement.all(...args) }),
          run: async () => statement.run(...args),
        };
      } };
    } },
    BUCKET: {
      put: async (key, value) => files.set(key, value),
      get: async key => files.has(key) ? { body: files.get(key) } : null,
      delete: async key => files.delete(key),
    },
  };
  async function call(path, { method = "GET", data, token, bytes, mime } = {}) {
    return worker.fetch(new Request("https://test.invalid/api" + path, {
      method, headers: { ...(token ? { authorization: "Bearer " + token } : {}),
        ...(data ? { "content-type": "application/json" } : {}), ...(mime ? { "content-type": mime } : {}) },
      ...((data || bytes) ? { body: bytes ?? JSON.stringify(data) } : {}),
    }), env);
  }
  try {
    for (const path of ["/owner/bookings", "/owner/content", "/owner/photos"]) {
      assert.equal((await call(path)).status, 401);
    }
    const booking = { name: "Test Customer", phone: "082 123 4567", area: "Plettenberg Bay", mapLink: "https://maps.app.goo.gl/test", style: "Lashes", date: "2050-01-15", time: "10:00" };
    for (const wrong of [{name:""},{name:"12345"},{phone:"not a phone"},{phone:"+27012345678"},{area:""},{date:"2000-01-15"},{date:"2050-02-30"},{time:"25:01"},{time:"23:30"},{style:"Unknown service"}]) {
      assert.equal((await call("/bookings", {method:"POST",data:{...booking,...wrong}})).status,400,JSON.stringify(wrong));
    }
    assert.equal((await call("/bookings", { method: "POST", data: { ...booking, phone: "+27000000001" } })).status, 400);
    assert.equal((await call("/bookings", { method: "POST", data: { ...booking, mapLink: "javascript:alert(1)" } })).status, 400);
    const created = await call("/bookings", { method: "POST", data: booking });
    assert.equal(created.status, 201);
    const { id } = await created.json();
    assert.equal((await call("/bookings", {method:"POST",data:{...booking,name:"Another customer",phone:"083 123 4567"}})).status,409,"Pending time is already reserved");
    assert.equal((await call("/bookings", {method:"POST",data:{...booking,phone:"083 123 4567",time:"09:00",style:"Knotless braids"}})).status,409,"Reject different starting times whose service durations overlap");
    assert.equal((await (await call("/availability?style=Lashes&date=2050-01-15&time=10%3A30")).json()).available,false);
    const adjacent=await call("/bookings",{method:"POST",data:{...booking,phone:"083 123 4567",time:"11:30"}});
    assert.equal(adjacent.status,201,"Adjacent appointment starts exactly at previous end");
    const {id:adjacentId}=await adjacent.json();
    const publicStatus = await (await call("/bookings/" + id)).json();
    assert.equal(publicStatus.status, "Pending");
    assert.equal(publicStatus.clientName, undefined);
    const login = await call("/owner/login", { method: "POST", data: { username: env.OWNER_USERNAME, password: env.OWNER_PASSWORD } });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    const { bookings } = await (await call("/owner/bookings", { token })).json();
    const savedBooking=bookings.find(b=>b.id===id);
    assert.equal(savedBooking.clientPhone, "+27821234567");
    assert.equal(savedBooking.clientName, booking.name);
    assert.equal(savedBooking.mapLink, booking.mapLink);
    assert.equal((await call("/owner/bookings/"+id,{method:"PATCH",token,data:{status:"Completed"}})).status,409,"Cannot complete a pending request");
    assert.equal((await call("/owner/bookings/" + id, { method: "PATCH", token, data: { status: "Accepted" } })).status, 200);
    assert.equal((await call("/owner/bookings/"+id,{method:"PATCH",token,data:{status:"Completed"}})).status,409,"Cannot complete before appointment starts");
    assert.equal((await call("/owner/bookings/"+adjacentId,{method:"PATCH",token,data:{action:"reschedule",date:booking.date,time:"10:30"}})).status,409,"Owner reschedule must not double book");
    assert.equal((await call("/owner/bookings/"+adjacentId,{method:"PATCH",token,data:{status:"Cancelled"}})).status,200);
    assert.equal((await (await call("/availability?style=Lashes&date=2050-01-15&time=11%3A30")).json()).available,true,"Cancellation releases the time");
    const simultaneous=await Promise.all(["084 123 4567","085 123 4567"].map(phone=>call("/bookings",{method:"POST",data:{...booking,phone,date:"2050-02-15"}})));
    assert.deepEqual(simultaneous.map(r=>r.status).sort(),[201,409],"Only one simultaneous overlapping request succeeds");
    const availability = await (await call("/availability?style=Lashes&date=2050-01-15&time=10%3A00")).json();
    assert.equal(availability.available, false);
    // Move the accepted appointment into the past to exercise the real Done transition without waiting.
    const past=new Date(Date.now()-172800000).toISOString().slice(0,10);
    sqlite.prepare("UPDATE bookings SET date=? WHERE id=?").run(past,id);
    assert.equal((await call("/owner/bookings/"+id,{method:"PATCH",token,data:{status:"Completed"}})).status,200);
    const active=await (await call("/owner/bookings?view=active",{token})).json();
    assert.equal(active.bookings.some(b=>b.id===id),false,"Done is removed from active appointments");
    const history=await (await call("/owner/bookings?view=history",{token})).json();
    assert.equal(history.bookings.find(b=>b.id===id).status,"Completed","Done stays in private history");
    const report=await (await call("/owner/reports/monthly?month="+past.slice(0,7),{token})).json();
    assert.equal(report.totals.Completed,1,"Done is included in monthly reports");
    assert.equal((await (await call("/bookings/"+id)).json()).status,"Completed","Customer receives completion status");
    assert.equal((await call("/owner/photos?caption=Test", { method: "POST", token, bytes: "bad", mime: "image/jpeg" })).status, 400);
    const bytes = new Uint8Array([255, 216, 255, 224, 0, 0]);
    const uploaded = await call("/owner/photos?caption=Test%20picture", { method: "POST", token, bytes, mime: "image/jpeg" });
    assert.equal(uploaded.status, 201);
    const photo = await uploaded.json();
    assert.equal((await call("/photos/" + photo.id)).status, 200);
    const content = { headline: "Welcome to Queencess", intro: "Book with us", announcement: "Bookings open", portfolioTitle: "Our work", showOriginalPhotos: false, heroPhoto: photo.id };
    assert.equal((await call("/owner/content", { method: "PUT", token, data: content })).status, 200);
    const published = await (await call("/content")).json();
    assert.deepEqual(published.content, content);
    assert.equal(published.photos[0].caption, "Test picture");
    assert.equal((await call("/owner/photos/" + photo.id, { method: "PATCH", token, data: { caption: "New caption" } })).status, 200);
    assert.equal((await (await call("/content")).json()).photos[0].caption, "New caption");
    assert.equal((await call("/owner/photos/" + photo.id, { method: "DELETE", token })).status, 200);
    assert.equal((await call("/photos/" + photo.id)).status, 404);
    assert.equal(files.size, 0);
    assert.equal((await call("/owner/logout", { method: "POST", token })).status, 200);
    assert.equal((await call("/owner/content", { token })).status, 401);
  } finally { sqlite.close(); }
});
