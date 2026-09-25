// Secure server-side proxy for the EOD Monitoring Matrix database.
// Credentials (SUPABASE_URL, SUPABASE_SERVICE_KEY) live only as Vercel
// environment variables and are NEVER sent to the browser.
// Every request must include a valid passcode in the x-passcode header,
// checked here on the server against APP_PASSCODES (comma separated; the
// legacy single APP_PASSCODE variable is still honoured).
//
// Endpoints (all require the passcode):
//   GET    /api/data?verify=1            -> { ok: true, index }  index = position of the matched passcode
//   GET    /api/data?paged=1&offset=N    -> { rows: [...], next: N|null }  (used by the app; bounded response size)
//   GET    /api/data                     -> [ ...all rows ]  (legacy shape; still paginates upstream)
//   GET    /api/data?presence=1          -> presence rows
//   GET    /api/data?backups=1           -> manual backup rows
//   POST   /api/data      { key, value } -> upsert one row
//   DELETE /api/data?key=...             -> delete one row

import { createHash, timingSafeEqual } from "node:crypto";

// Vercel serverless responses are capped at ~4.5 MB; stay comfortably below it per page.
const PAGE_BYTE_BUDGET = 3 * 1024 * 1024;
const UPSTREAM_PAGE_SIZE = 200;

// Only keys this app actually writes are accepted.
//   eod_matrix_<name>            whole-value rows
//   eod_matrix_<name>::<id>      per-record rows
//   presence:<slug>              heartbeat rows
//   manual_backup_<ts>[::<part>] cloud backups
const KEY_PATTERNS = [
  /^eod_matrix_[A-Za-z0-9_]{1,80}(::\S{1,200})?$/,
  /^presence:[A-Za-z0-9_-]{1,60}$/,
  /^manual_backup_[A-Za-z0-9_-]{1,60}(::[A-Za-z0-9_-]{1,60})?$/,
];
const isValidKey = (k) => typeof k === "string" && k.length <= 320 && KEY_PATTERNS.some((re) => re.test(k));

const sha = (s) => createHash("sha256").update(String(s)).digest();

// Returns the index of the matching passcode, or -1. Compares fixed-length digests in constant time.
function matchPasscode(provided, allowed) {
  if (typeof provided !== "string" || !provided) return -1;
  const p = sha(provided);
  let found = -1;
  allowed.forEach((a, i) => {
    if (timingSafeEqual(p, sha(a)) && found === -1) found = i;
  });
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  // Same-origin app: no CORS headers are emitted, so other websites cannot call this API from a browser.
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const ALLOWED_PASSCODES = (process.env.APP_PASSCODES || process.env.APP_PASSCODE || "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || ALLOWED_PASSCODES.length === 0) {
    return res.status(500).json({ error: "Server not configured. Set SUPABASE_URL, SUPABASE_SERVICE_KEY, APP_PASSCODES in Vercel Environment Variables." });
  }

  const passcodeIndex = matchPasscode(req.headers["x-passcode"], ALLOWED_PASSCODES);
  if (passcodeIndex === -1) {
    await sleep(300); // blunt online guessing a little
    return res.status(401).json({ error: "Invalid or missing passcode." });
  }

  const sbHeaders = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: "Bearer " + SUPABASE_SERVICE_KEY,
    "Content-Type": "application/json",
  };
  const kv = `${SUPABASE_URL}/rest/v1/kv_store`;

  try {
    if (req.method === "GET") {
      const q = req.query || {};

      if (q.verify) {
        return res.status(200).json({ ok: true, index: passcodeIndex });
      }

      const pattern = q.presence ? "presence:*" : q.backups ? "manual_backup_*" : "eod_matrix_*";
      const paged = !!q.paged;
      const startOffset = Math.max(0, parseInt(q.offset, 10) || 0);

      // PostgREST silently caps every response (default 1000 rows), so read in pages until exhausted.
      const rows = [];
      let bytes = 0;
      let offset = startOffset;
      let next = null;
      for (;;) {
        const url = `${kv}?select=key,value&key=like.${pattern}&order=key.asc&limit=${UPSTREAM_PAGE_SIZE}&offset=${offset}`;
        const r = await fetch(url, { headers: sbHeaders });
        const data = await r.json();
        if (!r.ok || !Array.isArray(data)) {
          return res.status(r.ok ? 502 : r.status).json(data && !Array.isArray(data) ? data : { error: "Unexpected upstream response" });
        }
        let stopped = false;
        for (let i = 0; i < data.length; i++) {
          const row = data[i];
          const rowBytes = (row.key ? row.key.length : 0) + (typeof row.value === "string" ? row.value.length : JSON.stringify(row.value ?? "").length);
          // Stop *before* a row that would push this response over budget (but always return at least one row).
          if (paged && rows.length > 0 && bytes + rowBytes > PAGE_BYTE_BUDGET) {
            next = offset + i;
            stopped = true;
            break;
          }
          rows.push(row);
          bytes += rowBytes;
        }
        if (stopped) break;
        offset += data.length;
        if (data.length < UPSTREAM_PAGE_SIZE) { next = null; break; }
      }
      return res.status(200).json(paged ? { rows, next } : rows);
    }

    if (req.method === "POST") {
      const { key, value } = req.body || {};
      if (!key || typeof value === "undefined") {
        return res.status(400).json({ error: "key and value are required" });
      }
      if (!isValidKey(key)) {
        return res.status(400).json({ error: "key not allowed" });
      }
      const r = await fetch(kv, {
        method: "POST",
        headers: { ...sbHeaders, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
      });
      const text = await r.text();
      return res.status(r.status).send(text || "{}");
    }

    if (req.method === "DELETE") {
      const key = req.query && req.query.key;
      if (!key) return res.status(400).json({ error: "key is required" });
      if (!isValidKey(key)) return res.status(400).json({ error: "key not allowed" });
      const r = await fetch(`${kv}?key=eq.${encodeURIComponent(key)}`, {
        method: "DELETE",
        headers: sbHeaders,
      });
      const text = await r.text();
      return res.status(r.status).send(text || "{}");
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(502).json({ error: "Upstream database error", detail: String(e) });
  }
}
