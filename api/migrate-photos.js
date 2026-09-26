// ONE-TIME cleanup: scans kv_store for per-record rows (eod_matrix_*::*) whose
// evidencePhoto field is still a raw base64 data URL (saved before api/upload.js
// existed), uploads each photo to the private "evidence-photos" Storage bucket,
// and rewrites the row so evidencePhoto is a short signed URL instead.
//
// Safe to run more than once: rows that are already migrated (evidencePhoto is
// already a URL, not a data: URL) are skipped automatically.
//
// GET /api/migrate-photos?dryRun=1   -> reports what WOULD change, writes nothing
// GET /api/migrate-photos            -> actually migrates
// Both require the x-passcode header, same as api/data.js and api/upload.js.
//
// Delete this file once you've confirmed the migration ran cleanly -- it's a
// one-time tool, not part of normal app operation.

import { createHash, timingSafeEqual } from "node:crypto";

const BUCKET = "evidence-photos";
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 365;
const ROW_PATTERN = "eod_matrix_*::*"; // PostgREST's `like` filter uses * in place of % to avoid URL % encoding issues
const PAGE_SIZE = 100;

const sha = (s) => createHash("sha256").update(String(s)).digest();

function matchPasscode(provided, allowed) {
  if (typeof provided !== "string" || !provided) return -1;
  const p = sha(provided);
  let found = -1;
  allowed.forEach((a, i) => { if (timingSafeEqual(p, sha(a)) && found === -1) found = i; });
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseDataUrl(dataUrl) {
  const m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(dataUrl || "");
  if (!m) return null;
  const ext = m[2] === "jpeg" ? "jpg" : m[2];
  return { mime: m[1], ext, buf: Buffer.from(m[3], "base64") };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const ALLOWED_PASSCODES = (process.env.APP_PASSCODES || process.env.APP_PASSCODE || "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || ALLOWED_PASSCODES.length === 0) {
    return res.status(500).json({ error: "Server not configured." });
  }
  if (matchPasscode(req.headers["x-passcode"], ALLOWED_PASSCODES) === -1) {
    await sleep(300);
    return res.status(401).json({ error: "Invalid or missing passcode." });
  }

  const dryRun = !!(req.query && req.query.dryRun);
  const sbHeaders = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: "Bearer " + SUPABASE_SERVICE_KEY,
    "Content-Type": "application/json",
  };
  const kv = `${SUPABASE_URL}/rest/v1/kv_store`;

  const report = { scanned: 0, migrated: 0, skipped_no_photo: 0, already_migrated: 0, errors: [] };

  try {
    let offset = 0;
    for (;;) {
      const url = `${kv}?select=key,value&key=like.${ROW_PATTERN}&order=key.asc&limit=${PAGE_SIZE}&offset=${offset}`;
      const r = await fetch(url, { headers: sbHeaders });
      const rows = await r.json();
      if (!r.ok || !Array.isArray(rows)) {
        report.errors.push({ stage: "fetch_page", offset, detail: rows });
        break;
      }
      if (rows.length === 0) break;

      for (const row of rows) {
        report.scanned++;
        let record;
        try { record = JSON.parse(row.value); } catch (e) { continue; }
        if (!record || typeof record !== "object" || !record.evidencePhoto) { report.skipped_no_photo++; continue; }

        const parsed = parseDataUrl(record.evidencePhoto);
        if (!parsed) { report.already_migrated++; continue; } // already a URL, not base64

        if (dryRun) { report.migrated++; continue; }

        try {
          const path = `migrated/${row.key.replace(/[^A-Za-z0-9_-]/g, "_")}.${parsed.ext}`;
          const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
            method: "POST",
            headers: {
              apikey: SUPABASE_SERVICE_KEY,
              Authorization: "Bearer " + SUPABASE_SERVICE_KEY,
              "Content-Type": parsed.mime,
              "x-upsert": "true",
            },
            body: parsed.buf,
          });
          if (!uploadRes.ok) { report.errors.push({ key: row.key, stage: "upload", detail: await uploadRes.text() }); continue; }

          const signRes = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${path}`, {
            method: "POST",
            headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: "Bearer " + SUPABASE_SERVICE_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_SECONDS }),
          });
          const signData = await signRes.json();
          if (!signRes.ok || !signData.signedURL) { report.errors.push({ key: row.key, stage: "sign", detail: signData }); continue; }

          record.evidencePhoto = `${SUPABASE_URL}/storage/v1${signData.signedURL}`;
          const writeRes = await fetch(kv, {
            method: "POST",
            headers: { ...sbHeaders, Prefer: "resolution=merge-duplicates" },
            body: JSON.stringify({ key: row.key, value: JSON.stringify(record), updated_at: new Date().toISOString() }),
          });
          if (!writeRes.ok) { report.errors.push({ key: row.key, stage: "writeback", detail: await writeRes.text() }); continue; }

          report.migrated++;
        } catch (e) {
          report.errors.push({ key: row.key, stage: "exception", detail: String(e) });
        }
      }

      if (rows.length < PAGE_SIZE) break;
      offset += rows.length;
    }

    return res.status(200).json({ dryRun, ...report });
  } catch (e) {
    return res.status(502).json({ error: "Migration failed", detail: String(e) });
  }
}
