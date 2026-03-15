import { useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push("/");
      } else {
        setError("Incorrect password. Try again.");
        setPassword("");
      }
    } catch (err) {
      setError("Something went wrong. Try again.");
    }
    setLoading(false);
  }

  return (
    <>
      <Head>
        <title>Yachie Lab — Sign In</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div style={{
        minHeight: "100vh",
        background: "#f3f4f6",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Arial, sans-serif",
      }}>
        <div style={{
          background: "white",
          borderRadius: 12,
          padding: "40px 36px",
          width: "100%",
          maxWidth: 380,
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
          border: "1px solid #e5e7eb",
        }}>
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: "#1e3a5f", marginBottom: 4 }}>
              Yachie Lab
            </div>
            <div style={{ fontSize: 13, color: "#6b7280" }}>
              Grant Management System
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
              Lab password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoFocus
              required
              style={{
                width: "100%",
                boxSizing: "border-box",
                border: error ? "1px solid #ef4444" : "1px solid #d1d5db",
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: 14,
                marginBottom: 8,
                outline: "none",
              }}
            />
            {error && (
              <div style={{ fontSize: 12, color: "#ef4444", marginBottom: 12 }}>{error}</div>
            )}
            <button
              type="submit"
              disabled={loading || !password}
              style={{
                width: "100%",
                background: loading || !password ? "#93c5fd" : "#1d4ed8",
                color: "white",
                border: "none",
                borderRadius: 8,
                padding: "10px 0",
                fontSize: 14,
                fontWeight: 600,
                cursor: loading || !password ? "not-allowed" : "pointer",
                marginTop: 4,
              }}
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <div style={{ marginTop: 20, fontSize: 11, color: "#9ca3af", textAlign: "center" }}>
            Contact your lab manager if you need access.
          </div>
        </div>
      </div>
    </>
  );
}
