import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve, extname, sep } from "node:path";

const ownerKey = process.env.OWNER_API_KEY;
if (!ownerKey || ownerKey.length < 32) {
  throw new Error("Set OWNER_API_KEY to a secret of at least 32 characters before starting.");
}
const dataDirectory = resolve(process.env.DATA_DIRECTORY || "data");
mkdirSync(dataDirectory, { recursive: true });
const db = new DatabaseSync(resolve(dataDirectory, "bookings.sqlite"));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    style TEXT NOT NULL,
    area TEXT NOT NULL,
    mapLink TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending',
    createdAt TEXT NOT NULL
  );
`);
const services = ["Knotless braids", "Feed-in cornrows", "Boho braids", "Lashes"];
const root = resolve("dist");

function reply(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(data));
}

function authorized(request) {
  const supplied = Buffer.from(request.headers.authorization || "");
  const expected = Buffer.from("Bearer " + ownerKey);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function body(request) {
  let text = "";
  for await (const chunk of request) {
    text += chunk;
    if (Buffer.byteLength(text) > 8192) {
      throw Object.assign(new Error("Request is too large."), { status: 413 });
    }
  }
  try { return JSON.parse(text); }
  catch { throw Object.assign(new Error("Send a valid JSON body."), { status: 400 }); }
}

function validate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const { style, date, time } = input;
  const area = typeof input.area === "string" ? input.area.trim() : "";
  const mapLink = typeof input.mapLink === "string" ? input.mapLink.trim() : "";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());
  if (!services.includes(style) || !area || area.length > 120 ||
      typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date ||
      date < today || typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
      mapLink.length > 2000) return null;
  if (mapLink) {
    try { if (new URL(mapLink).protocol !== "https:") return null; }
    catch { return null; }
  }
  return { style, area, mapLink, date, time };
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    const path = url.pathname;
    if (path === "/api/health" && request.method === "GET") {
      return reply(response, 200, { status: "ok" });
    }
    if (path === "/api/bookings" && request.method === "POST") {
      const booking = validate(await body(request));
      if (!booking) return reply(response, 400, { error: "Check service, area, future date, time and HTTPS map link." });
      const id = randomUUID();
      db.prepare("INSERT INTO bookings (id,style,area,mapLink,date,time,createdAt) VALUES (?,?,?,?,?,?,?)")
        .run(id, booking.style, booking.area, booking.mapLink, booking.date, booking.time, new Date().toISOString());
      return reply(response, 201, { id, status: "Pending" });
    }
    if (path.startsWith("/api/owner/")) {
      if (!authorized(request)) return reply(response, 401, { error: "Owner authentication required." });
      if (path === "/api/owner/bookings" && request.method === "GET") {
        return reply(response, 200, { bookings: db.prepare("SELECT * FROM bookings ORDER BY createdAt DESC LIMIT 100").all() });
      }
      const match = path.match(/^\/api\/owner\/bookings\/([a-f0-9-]{36})$/);
      if (match && request.method === "PATCH") {
        const input = await body(request);
        if (!["Accepted", "Declined"].includes(input?.status)) return reply(response, 400, { error: "Choose Accepted or Declined." });
        // A conditional update keeps concurrent owner decisions consistent.
        db.prepare("UPDATE bookings SET status=? WHERE id=? AND status='Pending'").run(input.status, match[1]);
        const booking = db.prepare("SELECT * FROM bookings WHERE id=?").get(match[1]);
        if (!booking) return reply(response, 404, { error: "Booking not found." });
        if (booking.status !== input.status) return reply(response, 409, { error: "Booking already has a different decision." });
        return reply(response, 200, { booking });
      }
    }
    if (path.startsWith("/api/")) return reply(response, 404, { error: "Endpoint not found." });
    if (!["GET", "HEAD"].includes(request.method)) return reply(response, 405, { error: "Method not allowed." });
    const file = resolve(root, "." + decodeURIComponent(path === "/" ? "/index.html" : path));
    if (!file.startsWith(root + sep)) return reply(response, 404, { error: "File not found." });
    const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
    try {
      const content = readFileSync(file);
      response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "X-Content-Type-Options": "nosniff" });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch { reply(response, 404, { error: "File not found." }); }
  } catch (error) {
    reply(response, error.status || 500, { error: error.status ? error.message : "Server error." });
  }
});
server.listen(Number(process.env.PORT || 3000), process.env.HOST || "127.0.0.1", () => {
  console.log("Queencess backend listening on port " + server.address().port);
});
