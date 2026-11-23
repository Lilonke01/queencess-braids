import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve, extname, sep } from "node:path";

const ownerUsername = process.env.OWNER_USERNAME || "owner";
const ownerPassword = process.env.OWNER_PASSWORD || process.env.OWNER_API_KEY;
if (!ownerPassword || ownerPassword.length < 16) {
  throw new Error("Set OWNER_PASSWORD to a strong password of at least 16 characters.");
}
const sessions = new Map();
const loginFailures = new Map();
// Store appointment data outside the public dist directory. The same database is reopened after a restart.
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
const durations = new Map([
  ["Knotless braids", 180], ["Feed-in cornrows", 120], ["Boho braids", 240], ["Lashes", 90],
]);
db.exec(`
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY,
    phone TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS bookings_date_status ON bookings(date, status);
`);
// Add columns to older local databases in place so existing booking references stay valid.
const columns = db.prepare("PRAGMA table_info(bookings)").all().map(({ name }) => name);
if (!columns.includes("clientId")) db.exec("ALTER TABLE bookings ADD COLUMN clientId INTEGER REFERENCES clients(id)");
if (!columns.includes("duration")) {
  db.exec("ALTER TABLE bookings ADD COLUMN duration INTEGER NOT NULL DEFAULT 120");
  const setDuration = db.prepare("UPDATE bookings SET duration=? WHERE style=?");
  for (const [style, duration] of durations) setDuration.run(duration, style);
}
const reserveStatuses = ["Accepted", "Completed", "No-show"];
const root = resolve("dist");

function reply(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(data));
}

function sameSecret(value, expected) {
  const supplied = Buffer.from(typeof value === "string" ? value : "");
  const secret = Buffer.from(expected);
  return supplied.length === secret.length && timingSafeEqual(supplied, secret);
}

function ownerSession(request) {
  return request.headers.authorization?.match(/^Bearer ([a-f0-9-]+)$/)?.[1];
}

// Acquire SQLite's write lock before checking availability. Another process cannot reserve the slot mid-update.
function transaction(action) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function minutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function validSlot(date, time, duration) {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date &&
    typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) &&
    minutes(time) + duration <= 1440;
}

function appointmentStarted(date, time) {
  return Date.parse(date + "T" + time + ":00+02:00") <= Date.now();
}

// Compare half-open intervals so an appointment can start exactly when the preceding one ends.
function blocked(date, time, duration, excludeId = "") {
  const start = minutes(time);
  return db.prepare(`
    SELECT time, duration FROM bookings
    WHERE date=? AND status IN (?, ?, ?) AND id!=?
  `).all(date, ...reserveStatuses, excludeId).some((booking) => {
    const existingStart = minutes(booking.time);
    return start < existingStart + booking.duration && existingStart < start + duration;
  });
}

// Convert local and international spellings to one number before linking repeat visits.
function normalizePhone(value) {
  const phone = typeof value === "string" ? value.trim().replace(/[\s().-]/g, "") : "";
  if (/^0\d{9}$/.test(phone)) return "+27" + phone.slice(1);
  if (/^27\d{9}$/.test(phone)) return "+" + phone;
  if (/^00[1-9]\d{7,14}$/.test(phone)) return "+" + phone.slice(2);
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
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

function salonDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());
}

function validate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const { style, date, time } = input;
  const area = typeof input.area === "string" ? input.area.trim() : "";
  const mapLink = typeof input.mapLink === "string" ? input.mapLink.trim() : "";
  const duration = durations.get(style);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const phone = normalizePhone(input.phone);
  if (!name || name.length > 100 || !phone || !duration || !area || area.length > 120 ||
      !validSlot(date, time, duration) || appointmentStarted(date, time) || mapLink.length > 2000) return null;
  if (mapLink) {
    try { if (new URL(mapLink).protocol !== "https:") return null; }
    catch { return null; }
  }
  return { style, area, mapLink, date, time, duration, name, phone };
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
      if (!booking) return reply(response, 400, { error: "Check your name, phone number, service, area and future appointment time. Map links must use HTTPS." });
      const id = randomUUID();
      const saved = transaction(() => {
        const { style, area, mapLink, date, time, duration, name, phone } = booking;
        if (blocked(date, time, duration)) return false;
        const existing = db.prepare(`
          SELECT 1 FROM bookings b JOIN clients c ON c.id=b.clientId
          WHERE c.phone=? AND b.style=? AND b.date=? AND b.time=? AND b.status='Pending'
        `).get(phone, style, date, time);
        if (existing) return false;
        const client = db.prepare(`
          INSERT INTO clients (phone, name) VALUES (?, ?)
          ON CONFLICT(phone) DO NOTHING RETURNING id
        `).get(phone, name) ?? db.prepare("SELECT id FROM clients WHERE phone=?").get(phone);
        db.prepare(`
          INSERT INTO bookings (id,style,area,mapLink,date,time,createdAt,clientId,duration)
          VALUES (?,?,?,?,?,?,?,?,?)
        `).run(id, style, area, mapLink, date, time, new Date().toISOString(), client.id, duration);
        return true;
      });
      if (!saved) return reply(response, 409, { error: "This time is unavailable or you already requested it. Choose another time." });
      return reply(response, 201, { id, status: "Pending" });
    }
    if (path === "/api/availability" && request.method === "GET") {
      const date = url.searchParams.get("date");
      const time = url.searchParams.get("time");
      const duration = durations.get(url.searchParams.get("style"));
      const available = Boolean(duration && validSlot(date, time, duration) &&
        !appointmentStarted(date, time) && !blocked(date, time, duration));
      return reply(response, 200, { available });
    }
    // The random booking ID lets the client check their own status without exposing contact details.
    const statusMatch = path.match(/^\/api\/bookings\/([a-f0-9-]{36})$/);
    if (statusMatch && request.method === "GET") {
      const booking = db.prepare("SELECT id, status, date, time FROM bookings WHERE id=?").get(statusMatch[1]);
      if (!booking) return reply(response, 404, { error: "Booking not found." });
      return reply(response, 200, booking);
    }
    if (path.startsWith("/api/owner/")) {
      // Issue a short-lived token after checking credentials. The browser never stores the password.
      if (path === "/api/owner/login" && request.method === "POST") {
        const credentials = await body(request);
        const now = Date.now();
        for (const [address, failure] of loginFailures) {
          if (failure.until <= now) loginFailures.delete(address);
        }
        const address = request.socket.remoteAddress;
        const failure = loginFailures.get(address) ?? { count: 0, until: now + 15 * 60 * 1000 };
        if (failure.count >= 10) return reply(response, 429, { error: "Too many attempts. Try again in 15 minutes." });
        if (credentials?.username !== ownerUsername || !sameSecret(credentials.password, ownerPassword)) {
          failure.count++;
          loginFailures.set(address, failure);
          return reply(response, 401, { error: "Incorrect username or password." });
        }
        loginFailures.delete(address);
        for (const [token, expiry] of sessions) {
          if (expiry <= now) sessions.delete(token);
        }
        const token = randomUUID();
        sessions.set(token, now + 8 * 60 * 60 * 1000);
        return reply(response, 200, { token });
      }
      const token = ownerSession(request);
      if (!(sessions.get(token) > Date.now())) return reply(response, 401, { error: "Sign in to the owner account." });
      if (path === "/api/owner/logout" && request.method === "POST") {
        sessions.delete(token);
        return reply(response, 200, { signedOut: true });
      }
      if (path === "/api/owner/bookings" && request.method === "GET") {
        return reply(response, 200, { bookings: db.prepare("SELECT b.*, c.name AS clientName, c.phone AS clientPhone FROM bookings b LEFT JOIN clients c ON c.id=b.clientId ORDER BY (b.status IN ('Pending', 'Accepted')) DESC, b.createdAt DESC").all() });
      }
      if (path === "/api/owner/reports/monthly" && request.method === "GET") {
        const month = url.searchParams.get("month") ?? salonDate().slice(0, 7);
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
          return reply(response, 400, { error: "Enter a month in YYYY-MM format." });
        }
        // Report by the scheduled appointment date. Unique-client totals include only completed visits.
        const rows = db.prepare(`
          SELECT style, status, COUNT(*) AS count
          FROM bookings WHERE date BETWEEN ? AND ?
          GROUP BY style, status ORDER BY style
        `).all(month + "-01", month + "-31");
        const totals = { Pending: 0, Accepted: 0, Declined: 0, Completed: 0, Cancelled: 0, "No-show": 0 };
        const completedByService = [];
        for (const { style, status, count } of rows) {
          totals[status] += count;
          if (status === "Completed") completedByService.push({ style, count });
        }
        const clients = db.prepare(`
          SELECT COUNT(DISTINCT clientId) AS uniqueClients,
            COUNT(*) - COUNT(clientId) AS completedWithoutClient
          FROM bookings WHERE status='Completed' AND date BETWEEN ? AND ?
        `).get(month + "-01", month + "-31");
        return reply(response, 200, { month, totals, completedByService, ...clients });
      }
      const match = path.match(/^\/api\/owner\/bookings\/([a-f0-9-]{36})$/);
      if (match && request.method === "PATCH") {
        const input = await body(request);
        const result = transaction(() => {
          const id = match[1];
          const booking = db.prepare("SELECT * FROM bookings WHERE id=?").get(id);
          if (!booking) return { code: 404, error: "Booking not found." };
          const open = ["Pending", "Accepted"].includes(booking.status);
          if (input?.action === "reschedule") {
            const { date, time } = input;
            if (!open) return { code: 409, error: "Only pending or approved appointments can be moved." };
            if (!validSlot(date, time, booking.duration) || appointmentStarted(date, time)) {
              return { code: 400, error: "Choose a valid future appointment time." };
            }
            if (blocked(date, time, booking.duration, id)) return { code: 409, error: "That time overlaps another appointment." };
            db.prepare("UPDATE bookings SET date=?, time=? WHERE id=?").run(date, time, id);
            return { code: 200 };
          }
          // Only open bookings can be cancelled. Attendance is recorded after an approved slot starts.
          const status = input?.status;
          if (!["Accepted", "Declined", "Completed", "Cancelled", "No-show"].includes(status)) {
            return { code: 400, error: "Choose a valid booking action." };
          }
          if (status === booking.status) return { code: 200 };
          const started = appointmentStarted(booking.date, booking.time);
          const allowed = status === "Cancelled" ? open
            : ["Accepted", "Declined"].includes(status) ? booking.status === "Pending"
            : booking.status === "Accepted" && started;
          if (!allowed) return { code: 409, error: "This action is unavailable for the booking's current status or time." };
          if (status === "Accepted" && (started || blocked(booking.date, booking.time, booking.duration, id))) {
            return { code: 409, error: "This slot has started or overlaps another appointment. Reschedule it before approving." };
          }
          db.prepare("UPDATE bookings SET status=? WHERE id=?").run(status, id);
          return { code: 200 };
        });
        if (result.error) return reply(response, result.code, { error: result.error });
        return reply(response, 200, { booking: db.prepare("SELECT * FROM bookings WHERE id=?").get(match[1]) });
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
