import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../worker/index.js";

test("real booking, private owner management and persistent content/photo lifecycle", async () => {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of ["0000_booking", "0001_reviews", "0002_review_display_name", "0003_live_content"]) {
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
    assert.equal((await call("/bookings", { method: "POST", data: { ...booking, phone: "+27000000001" } })).status, 400);
    assert.equal((await call("/bookings", { method: "POST", data: { ...booking, mapLink: "javascript:alert(1)" } })).status, 400);
    const created = await call("/bookings", { method: "POST", data: booking });
    assert.equal(created.status, 201);
    const { id } = await created.json();
    const publicStatus = await (await call("/bookings/" + id)).json();
    assert.equal(publicStatus.status, "Pending");
    assert.equal(publicStatus.clientName, undefined);
    const login = await call("/owner/login", { method: "POST", data: { username: env.OWNER_USERNAME, password: env.OWNER_PASSWORD } });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    const { bookings } = await (await call("/owner/bookings", { token })).json();
    assert.equal(bookings[0].clientPhone, "+27821234567");
    assert.equal(bookings[0].clientName, booking.name);
    assert.equal(bookings[0].mapLink, booking.mapLink);
    assert.equal((await call("/owner/bookings/" + id, { method: "PATCH", token, data: { status: "Accepted" } })).status, 200);
    const availability = await (await call("/availability?style=Lashes&date=2050-01-15&time=10%3A00")).json();
    assert.equal(availability.available, false);
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
