// Upstash Redis REST API — no package needed
// Add these in Vercel → Settings → Environment Variables:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN

const DATA_KEY = "lab-gms-data";
const META_KEY = "lab-gms-meta";

async function kvGet(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!json.result) return null;
  return JSON.parse(json.result);
}

async function kvSet(key, value) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(JSON.stringify(value)),
  });
}

export default async function handler(req, res) {
  const secret = req.headers["x-lab-secret"] || req.query.secret;
  const expected = process.env.LAB_SECRET;
  if (expected && secret !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method === "GET") {
    try {
      const data = await kvGet(DATA_KEY);
      const meta = await kvGet(META_KEY);
      return res.status(200).json({ data: data || null, meta: meta || null });
    } catch (e) {
      return res.status(500).json({ error: "Failed to read", detail: e.message });
    }
  }

  if (req.method === "POST") {
    try {
      const { data, savedBy } = req.body;
      await kvSet(DATA_KEY, data);
      const meta = { savedAt: new Date().toISOString(), savedBy: savedBy || "unknown" };
      await kvSet(META_KEY, meta);
      return res.status(200).json({ ok: true, meta });
    } catch (e) {
      return res.status(500).json({ error: "Failed to save", detail: e.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
