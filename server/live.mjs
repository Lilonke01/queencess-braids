// Runs the same API as the hosted site, with SQLite and a local photo directory.
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import worker from "../worker/index.js";

if (!process.env.OWNER_PASSWORD || process.env.OWNER_PASSWORD.length < 16) {
  throw new Error("Set OWNER_USERNAME and an OWNER_PASSWORD of at least 16 characters.");
}
const directory = resolve(process.env.DATA_DIRECTORY || "data");
await mkdir(resolve(directory, "photos"), { recursive: true });
// Preserve older local prototype databases; this live schema has its own database.
const db = new DatabaseSync(resolve(directory, "live-site.sqlite"));
db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS applied_migrations (tag TEXT PRIMARY KEY)");
const journal = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"));
for (const { tag } of journal.entries) {
  if (db.prepare("SELECT tag FROM applied_migrations WHERE tag=?").get(tag)) continue;
  db.exec("BEGIN");
  try {
    db.exec(readFileSync(new URL(`../drizzle/${tag}.sql`, import.meta.url), "utf8"));
    db.prepare("INSERT INTO applied_migrations(tag) VALUES(?)").run(tag);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
const photoPath = key => {
  if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error("Invalid photo key");
  return resolve(directory, "photos", key);
};
const env = {
  OWNER_USERNAME: process.env.OWNER_USERNAME, OWNER_PASSWORD: process.env.OWNER_PASSWORD,
  DB: { prepare(query) { return { bind(...args) {
    const statement = db.prepare(query);
    return { first: async () => statement.get(...args) ?? null,
      all: async () => ({ results: statement.all(...args) }), run: async () => statement.run(...args) };
  } }; } },
  BUCKET: { put: async (key, bytes) => writeFile(photoPath(key), bytes),
    get: async key => { try { return { body: await readFile(photoPath(key)) }; } catch (error) { if (error.code === "ENOENT") return null; throw error; } },
    delete: async key => { try { await unlink(photoPath(key)); } catch (error) { if (error.code !== "ENOENT") throw error; } } },
};
const root = resolve("netlify-dist");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png" };
createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      const request = new Request(url, { method: incoming.method, headers: incoming.headers,
        ...(!["GET", "HEAD"].includes(incoming.method) ? { body: Readable.toWeb(incoming), duplex: "half" } : {}) });
      const response = await worker.fetch(request, env);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body).pipe(outgoing); else outgoing.end();
      return;
    }
    const filename = resolve(root, "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
    if (!filename.startsWith(root + sep)) { outgoing.writeHead(404); outgoing.end(); return; }
    const bytes = await readFile(filename);
    outgoing.writeHead(200, { "Content-Type": types[extname(filename)] || "application/octet-stream", "X-Content-Type-Options": "nosniff" });
    outgoing.end(incoming.method === "HEAD" ? undefined : bytes);
  } catch (error) {
    outgoing.writeHead(error.code === "ENOENT" ? 404 : 500);
    outgoing.end("Unable to serve this request.");
    console.error(error.message);
  }
}).listen(Number(process.env.PORT || 3000), "127.0.0.1", () => console.log(`Live site preview: http://127.0.0.1:${process.env.PORT || 3000}`));
