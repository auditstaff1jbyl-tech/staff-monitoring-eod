// Secure server-side proxy for the EOD Monitoring Matrix database.
// Credentials (SUPABASE_URL, SUPABASE_SERVICE_KEY) live only as Vercel
// environment variables and are NEVER sent to the browser.
// Every request must include the correct passcode in the x-passcode header,
// checked here on the server against APP_PASSCODE.

export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const ALLOWED_PASSCODES = (process.env.APP_PASSCODES || process.env.APP_PASSCODE || "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || ALLOWED_PASSCODES.length === 0) {
    return res.status(500).json({ error: "Server not configured. Set SUPABASE_URL, SUPABASE_SERVICE_KEY, APP_PASSCODES in Vercel Environment Variables." });
  }

  const providedPasscode = req.headers["x-passcode"];
  if (!providedPasscode || !ALLOWED_PASSCODES.includes(providedPasscode)) {
    return res.status(401).json({ error: "Invalid or missing passcode." });
  }

  const sbHeaders = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: "Bearer " + SUPABASE_SERVICE_KEY,
    "Content-Type": "application/json",
  };

  try {
    if (req.method === "GET") {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?select=key,value&key=like.eod_matrix_*`, { headers: sbHeaders });
      const data = await r.json();
      return res.status(r.status).json(data);
    }

    if (req.method === "POST") {
      const { key, value } = req.body || {};
      if (!key || typeof value === "undefined") {
        return res.status(400).json({ error: "key and value are required" });
      }
      const r = await fetch(`${SUPABASE_URL}/rest/v1/kv_store`, {
        method: "POST",
        headers: { ...sbHeaders, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
      });
      const text = await r.text();
      return res.status(r.status).send(text || "{}");
    }

    if (req.method === "DELETE") {
      const key = req.query.key;
      if (!key) return res.status(400).json({ error: "key is required" });
      const r = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}`, {
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
