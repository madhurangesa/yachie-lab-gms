const DATA_KEY = "lab-gms-data";
const META_KEY = "lab-gms-meta";

async function kvGet(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN");
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (json.result === null || json.result === undefined) return null;
  try {
    return JSON.parse(json.result);
  } catch (e) {
    return null;
  }
}

async function kvSet(key, value) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN");
  const serialized = JSON.stringify(value);
  const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
    },
    body: serialized,
  });
  if (!res.ok) throw new Error("Upstash SET failed: " + res.status);
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
      console.error("GET error:", e.message);
      return res.status(500).json({ error: "Failed to read", detail: e.message });
    }
  }

  if (req.method === "POST") {
    try {
      const { data, savedBy } = req.body;
      await kvSet(DATA_KEY, data);
      const meta = {
        savedAt: new Date().toISOString(),
        savedBy: savedBy || "unknown",
      };
      await kvSet(META_KEY, meta);
      return res.status(200).json({ ok: true, meta });
    } catch (e) {
      console.error("POST error:", e.message);
      return res.status(500).json({ error: "Failed to save", detail: e.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
