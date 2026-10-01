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

// Passcode slot -> who is calling. KEEP IN SYNC with USER_DIRECTORY in assets/js/config.js
// (same order as the APP_PASSCODES environment variable). A slot that is not listed here
// is treated as a normal "full" account, exactly like before.
const USER_SLOTS = [
  { slug: "auditstaff1", name: "Audit Staff 1", role: "full" },
  { slug: "auditstaff2", name: "Audit Staff 2", role: "full" },
  { slug: "limitedviewer", name: "Limited Viewer", role: "limited" },
];

// Action-item replies: one row per reply (eod_matrix_action_replies_v1::<replyId>).
//  - The author (by / byName) is stamped HERE from the passcode that made the request,
//    so it cannot be forged from the browser.
//  - Append-only: a reply that already exists is never overwritten (ignore-duplicates).
const REPLIES_KEY = "eod_matrix_action_replies_v1";
const MAX_REPLY_LENGTH = 2000;

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

  const me = USER_SLOTS[passcodeIndex] || null;
  const isLimited = !!me && me.role === "limited";

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

      const isReply = key.startsWith(REPLIES_KEY + "::");

      // Read-only account: its changes are accepted by the API (so the app does not show a
      // false "not saved" warning) but are NOT written. Only its presence heartbeat and
      // replies are stored.
      if (isLimited && !isReply && !key.startsWith("presence:")) {
        return res.status(200).json({ ok: true, readOnly: true });
      }

      let body = value;
      let prefer = "resolution=merge-duplicates";

      if (isReply) {
        let rec = null;
        try { rec = typeof value === "string" ? JSON.parse(value) : value; } catch (e) { rec = null; }
        const okShape = rec && typeof rec === "object" && !Array.isArray(rec)
          && typeof rec.text === "string" && rec.text.trim().length > 0 && rec.text.length <= MAX_REPLY_LENGTH
          && (typeof rec.actionId === "string" || typeof rec.actionId === "number")
          && typeof rec.id === "string" && key === REPLIES_KEY + "::" + rec.id;
        if (!okShape) {
          return res.status(400).json({ error: "invalid reply" });
        }
        // Author is decided by the server, never by the browser.
        rec.by = me ? me.slug : "unknown";
        rec.byName = me ? me.name : "Unknown user";
        const t = Date.parse(rec.ts);
        if (!isFinite(t) || Math.abs(t - Date.now()) > 24 * 60 * 60 * 1000) rec.ts = new Date().toISOString();
        body = JSON.stringify(rec);
        prefer = "resolution=ignore-duplicates"; // append-only: an existing reply is never overwritten
      }

      const r = await fetch(kv, {
        method: "POST",
        headers: { ...sbHeaders, Prefer: prefer },
        body: JSON.stringify({ key, value: body, updated_at: new Date().toISOString() }),
      });
      const text = await r.text();
      return res.status(r.status).send(text || "{}");
    }

    if (req.method === "DELETE") {
      const key = req.query && req.query.key;
      if (!key) return res.status(400).json({ error: "key is required" });
      if (!isValidKey(key)) return res.status(400).json({ error: "key not allowed" });
      if (isLimited) {
        // Read-only account can never delete anything (see POST above).
        return res.status(200).json({ ok: true, readOnly: true });
      }
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
