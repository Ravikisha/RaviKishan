// SERVER ONLY. Never import this from a component — it reads the B2 secret.
//
// Presigns S3-compatible URLs for the private `rk-vault` bucket so the browser
// can PUT/GET bytes directly to Backblaze without the key ever leaving Vercel.
// The bucket is `allPrivate`, so a presigned URL is the ONLY way in, and each
// one expires in minutes.
//
// SigV4 is implemented here rather than pulling in @aws-sdk: the query-string
// (presigned) flavour is ~40 lines of crypto, and a serverless function starts
// faster without two more packages.
import crypto from "crypto";

const ALGORITHM = "AWS4-HMAC-SHA256";

// RFC 3986 — encodeURIComponent leaves !'()* alone, S3 wants them encoded.
const uriEncode = (s) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );

// Object keys keep their slashes; every other segment is encoded.
const encodeKey = (key) => key.split("/").map(uriEncode).join("/");

const hmac = (key, data) =>
  crypto.createHmac("sha256", key).update(data, "utf8").digest();

const sha256hex = (data) =>
  crypto.createHash("sha256").update(data, "utf8").digest("hex");

export function b2Config() {
  const cfg = {
    accessKeyId: process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APP_KEY,
    bucket: process.env.B2_BUCKET,
    endpoint: process.env.B2_ENDPOINT,
    region: process.env.B2_REGION,
  };
  const missing = Object.entries(cfg)
    .filter(([, v]) => !v)
    .map(([k]) => k.replace(/([A-Z])/g, "_$1").toUpperCase());
  if (missing.length) {
    const e = new Error(
      `Vault storage is not configured on this deployment (missing ${missing.join(", ")}). ` +
        `Add the B2_* variables in Vercel → Settings → Environment Variables.`
    );
    e.code = "vault/not-configured";
    throw e;
  }
  return cfg;
}

export const isVaultConfigured = () => {
  try {
    b2Config();
    return true;
  } catch (_) {
    return false;
  }
};

// Returns a presigned URL valid for `expiresIn` seconds.
// Only `host` is signed, so the browser is free to set its own Content-Type
// without invalidating the signature.
//
// `key` may be empty for a bucket-level request (listing), and `query` adds
// extra parameters. SigV4 hashes the WHOLE sorted query string, so extras have
// to go through the same canonicalisation as the auth parameters rather than
// being appended afterwards.
export function presign({ method, key, expiresIn = 300, query = {} }) {
  const { accessKeyId, secretAccessKey, bucket, endpoint, region } = b2Config();
  const host = new URL(endpoint).host;

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/s3/aws4_request`;

  const params = {
    ...query,
    "X-Amz-Algorithm": ALGORITHM,
    "X-Amz-Credential": `${accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(params[k])}`)
    .join("&");

  const canonicalUri = key ? `/${bucket}/${encodeKey(key)}` : `/${bucket}`;
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    ALGORITHM,
    amzDate,
    scope,
    sha256hex(canonicalRequest),
  ].join("\n");

  let signingKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  signingKey = hmac(signingKey, region);
  signingKey = hmac(signingKey, "s3");
  signingKey = hmac(signingKey, "aws4_request");

  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  return `${endpoint}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

// Object keys are confined to the vault/ prefix and a conservative charset, so
// a crafted key can't sign a URL for something else in the bucket.
const KEY_RE = /^vault\/[A-Za-z0-9_][A-Za-z0-9._\-/]{0,199}$/;

// Blog media lives in the SAME bucket under a different prefix. Backblaze
// bucket visibility is per-bucket and a public bucket needs payment history on
// the account, so "public" media is instead served through /api/media/[...key],
// which presigns a read server-side and caches hard at the edge. One bucket,
// no card required, and the URLs sit on our own domain rather than B2's.
const MEDIA_KEY_RE = /^media\/[A-Za-z0-9_][A-Za-z0-9._\-/]{0,199}$/;

export function assertMediaKey(key) {
  if (
    typeof key !== "string" ||
    !MEDIA_KEY_RE.test(key) ||
    key.includes("..") ||
    key.includes("//") ||
    key.endsWith("/")
  ) {
    const e = new Error("Invalid media object key.");
    e.code = "media/bad-key";
    throw e;
  }
  return key;
}

export function assertVaultKey(key) {
  if (
    typeof key !== "string" ||
    !KEY_RE.test(key) ||
    key.includes("..") ||
    key.includes("//") ||
    key.endsWith("/")
  ) {
    const e = new Error("Invalid vault object key.");
    e.code = "vault/bad-key";
    throw e;
  }
  return key;
}
