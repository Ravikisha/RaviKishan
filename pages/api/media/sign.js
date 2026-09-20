// Presigns an upload for blog media. Admin only — same gate as the vault.
import { presign, assertMediaKey, isVaultConfigured } from "../../../lib/server/b2";
import { verifyAdmin, AuthError } from "../../../lib/server/verifyAdmin";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  try {
    await verifyAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    return res.status(500).json({ error: "Auth check failed." });
  }
  if (!isVaultConfigured()) return res.status(503).json({ error: "Storage is not configured." });

  const { key } = req.body || {};
  try {
    assertMediaKey(key);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  return res.status(200).json({
    url: presign({ method: "PUT", key, expiresIn: 300 }),
    publicUrl: `/api/media/${key.slice("media/".length)}`,
  });
}
