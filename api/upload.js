// Uploads EOD evidence photos to a private Supabase Storage bucket instead of
// embedding them as base64 inside kv_store rows / localStorage.
//
// Why: base64 evidence photos (~150-200KB each after client-side compression)
// were filling the browser's ~5MB localStorage quota after ~25-30 records, and
// eating into the Supabase Free plan's 500MB DATABASE quota. Storage has its
// own separate 1GB quota on the Free plan, so moving photos here buys a lot of
// headroom on both fronts without any plan upgrade.
//
// Same security model as api/data.js: SUPABASE_SERVICE_KEY only ever lives on
// the server (Vercel env var), never sent to the browser. Every request must
// carry a valid x-passcode header, checked the same way as api/data.js.
//
// Endpoints:
//   POST /api/upload   { dataUrl }  -> { url, path }
//     dataUrl must be a "data:image/...;base64,...." string (what
//     compressImageFile() in the client already produces).
//     Uploads to the "evidence-photos" bucket and returns a signed URL valid
//     for 1 year, plus the raw storage path (kept for the migration script /
//     future cleanup).

import { createHash, timingSafeEqual } from "node:crypto";

const BUCKET = "evidence-photos";
const MAX_DECODED_BYTES = 6 * 1024 * 1024; // safety ceiling, well above compressImageFile's own 2MB target
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year

const sha = (s) => createHash("sha256").update(String(s)).digest();

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

function parseDataUrl(dataUrl) {
  const m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(dataUrl || "");
  if (!m) return null;
  const mime = m[1];
  const ext = m[2] === "jpeg" ? "jpg" : m[2];
  const buf = Buffer.from(m[3], "base64");
  return { mime, ext, buf };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const ALLOWED_PASSCODES = (process.env.APP_PASSCODES || process.env.APP_PASSCODE || "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || ALLOWED_PASSCODES.length === 0) {
    return res.status(500).json({ error: "Server not configured. Set SUPABASE_URL, SUPABASE_SERVICE_KEY, APP_PASSCODES in Vercel Environment Variables." });
  }

  const passcodeIndex = matchPasscode(req.headers["x-passcode"], ALLOWED_PASSCODES);
  if (passcodeIndex === -1) {
    await sleep(300);
    return res.status(401).json({ error: "Invalid or missing passcode." });
  }

  try {
    const { dataUrl } = req.body || {};
    if (!dataUrl || typeof dataUrl !== "string") {
      return res.status(400).json({ error: "dataUrl is required" });
    }
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) {
      return res.status(400).json({ error: "dataUrl must be a base64 image/jpeg, image/png or image/webp data URL" });
    }
    if (parsed.buf.length > MAX_DECODED_BYTES) {
      return res.status(400).json({ error: "Image too large after decoding." });
    }

    const path = `${new Date().toISOString().slice(0, 10)}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${parsed.ext}`;

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
    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      return res.status(502).json({ error: "Storage upload failed", detail: text });
    }

    const signRes = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${path}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: "Bearer " + SUPABASE_SERVICE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_SECONDS }),
    });
    const signData = await signRes.json();
    if (!signRes.ok || !signData.signedURL) {
      return res.status(502).json({ error: "Could not create signed URL", detail: signData });
    }

    return res.status(200).json({ url: `${SUPABASE_URL}/storage/v1${signData.signedURL}`, path });
  } catch (e) {
    return res.status(502).json({ error: "Upload error", detail: String(e) });
  }
}
