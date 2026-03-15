export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { password } = req.body;
  const correct = process.env.LAB_PASSWORD;

  if (!correct) {
    return res.status(500).json({ error: "LAB_PASSWORD not set in environment variables" });
  }

  if (password !== correct) {
    return res.status(401).json({ error: "Incorrect password" });
  }

  // Set auth cookie — httpOnly so JS can't read it, secure in production
  res.setHeader("Set-Cookie", [
    `lab-auth=${correct}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
  ]);

  return res.status(200).json({ ok: true });
}
