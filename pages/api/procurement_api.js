/**
 * Lab GMS — Procurement API Route
 * pages/api/procurement.js
 *
 * Stores procurement data under a separate Redis key ("yachie-procurement")
 * so it never interferes with grant dashboard data.
 */

export default async function handler(req, res) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return res.status(500).json({ error: "Redis not configured — check UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel Settings." });
  }

  const KEY    = "yachie-procurement";
  const SECRET = process.env.NEXT_PUBLIC_LAB_SECRET || "yachie-lab-2025";

  // ── GET: load procurement data ─────────────────────────────────────────
  if (req.method === "GET") {
    const { secret } = req.query;
    if (secret !== SECRET) return res.status(401).json({ error: "Unauthorized" });

    try {
      const r = await fetch(`${url}/get/${KEY}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await r.json();
      if (!json.result) return res.json({ data: null });

      let parsed;
      try { parsed = JSON.parse(json.result); } catch {
        return res.json({ data: null });
      }
      return res.json({
        data: parsed,
        meta: { savedAt: parsed._savedAt, savedBy: parsed._savedBy },
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST: save procurement data ────────────────────────────────────────
  if (req.method === "POST") {
    const secret = req.headers["x-lab-secret"];
    if (secret !== SECRET) return res.status(401).json({ error: "Unauthorized" });

    try {
      const { data, savedBy } = req.body;
      const payload = {
        ...data,
        _savedAt: new Date().toISOString(),
        _savedBy: savedBy || "unknown",
      };

      await fetch(`${url}/set/${KEY}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "text/plain",
        },
        body: JSON.stringify(payload),
      });

      return res.json({
        ok: true,
        meta: { savedAt: payload._savedAt, savedBy: payload._savedBy },
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
