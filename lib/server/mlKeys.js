// Pasted-token accounts (Hugging Face, Kaggle). Parsing and credential
// shaping are pure; identify() is the one network call, made BEFORE anything
// is stored, so a bad key never becomes a row.
import { whoami as hfWhoami } from "./huggingface.js";
import { introspect, quota } from "./kaggle.js";

export class KeyError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.code = "account/bad-key";
  }
}

export function parseKey(provider, raw) {
  if (provider !== "huggingface" && provider !== "kaggle") {
    throw new KeyError(`${provider} is not connected with a pasted token.`);
  }
  const text = String(raw || "").trim();
  if (!text) throw new KeyError("Paste a token first.");
  if (provider === "huggingface") {
    if (!/^hf_[A-Za-z0-9]{20,}$/.test(text)) {
      throw new KeyError("A Hugging Face token starts with hf_ — create one at huggingface.co/settings/tokens.");
    }
    return { accessToken: text };
  }
  if (text.startsWith("{")) {
    let j;
    try {
      j = JSON.parse(text);
    } catch (_) {
      throw new KeyError("That looks like kaggle.json but is not valid JSON.");
    }
    if (!j.username) throw new KeyError('kaggle.json needs a "username".');
    if (!j.key) throw new KeyError('kaggle.json needs a "key".');
    const user = String(j.username).trim();
    return {
      accessToken: `Basic ${Buffer.from(`${user}:${String(j.key).trim()}`).toString("base64")}`,
      legacyUser: user,
    };
  }
  if (/\s/.test(text) || text.length < 20) {
    throw new KeyError(
      "A Kaggle token is one long string from kaggle.com/settings → API → Generate New Token, or paste the whole kaggle.json."
    );
  }
  return { accessToken: text };
}

// What a local CLI needs, rebuilt from the one stored string.
export function credentialMaterial(provider, accessToken) {
  if (provider === "huggingface") return { env: { HF_TOKEN: accessToken } };
  if (String(accessToken).startsWith("Basic ")) {
    const [username, ...rest] = Buffer.from(accessToken.slice(6), "base64").toString("utf8").split(":");
    const key = rest.join(":");
    return { kaggleJson: { username, key }, env: { KAGGLE_USERNAME: username, KAGGLE_KEY: key } };
  }
  return { env: { KAGGLE_API_TOKEN: accessToken } };
}

const rejected = (label, e) =>
  new KeyError(
    e.status === 401 ? `${label} rejected that token. Create a new one and paste it again.` : e.message,
    e.status === 401 ? 400 : 502
  );

// The account id comes from the provider's answer, never from the form.
export async function identify(provider, cred) {
  if (provider === "huggingface") {
    const j = await hfWhoami(cred.accessToken).catch((e) => {
      throw rejected("Hugging Face", e);
    });
    const role = j.auth?.accessToken?.role || "";
    return {
      accountId: j.name,
      label: j.fullname || j.name,
      email: j.email || "",
      scope: role,
      warning:
        role === "read"
          ? "This is a read token: search and reading work, but creating repos, committing and running Jobs need a write or fine-grained token."
          : "",
    };
  }
  if (cred.legacyUser) {
    // A legacy key cannot be introspected; the quota call needs a real
    // signed-in user, so it proves the key is live.
    await quota(cred.accessToken).catch((e) => {
      throw rejected("Kaggle", e);
    });
    return { accountId: cred.legacyUser, label: cred.legacyUser, email: "", scope: "legacy-key", warning: "" };
  }
  const j = await introspect(cred.accessToken).catch((e) => {
    throw rejected("Kaggle", e);
  });
  if (!j.active || !j.username) throw new KeyError("Kaggle says that token is not active. Generate a new one.");
  return { accountId: j.username, label: j.username, email: "", scope: j.scope || "", warning: "" };
}
