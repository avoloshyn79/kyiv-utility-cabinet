// Stores the Kyivvodokanal access token. The add-on does not log into
// Kyivvodokanal itself (its sign-in form is behind reCAPTCHA): you sign in
// in your own browser, copy `localStorage.access_token` (a JWT, valid ~7
// days, no refresh mechanism on the site) and hand it to the add-on, either
// as the `kyivvodokanal.token` option or via POST /token/kyivvodokanal.
// A token posted over HTTP is persisted under /data and survives restarts;
// whichever of the two expires later is used.
import { readFileSync, writeFileSync } from "node:fs";

const TOKEN_FILE = "/data/kyivvodokanal-token.json";

export class KyivvodokanalTokenError extends Error {}

function decodePayload(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf-8"));
  } catch {
    return null;
  }
}

// Accepts the raw JWT, optionally wrapped in quotes or prefixed with
// "Bearer " (whatever got copied out of DevTools).
export function normalizeToken(raw) {
  const token = String(raw ?? "")
    .trim()
    .replace(/^bearer\s+/i, "")
    .replace(/^"(.*)"$/, "$1");
  if (!token) return "";
  const payload = decodePayload(token);
  if (token.split(".").length !== 3 || !payload) {
    throw new KyivvodokanalTokenError("Not a JWT - expected the value of localStorage.access_token (starts with eyJ...)");
  }
  return token;
}

/** @returns {Date|null} */
export function tokenExpiry(token) {
  const exp = token ? decodePayload(token)?.exp : null;
  return typeof exp === "number" ? new Date(exp * 1000) : null;
}

function loadStoredToken() {
  try {
    return JSON.parse(readFileSync(TOKEN_FILE, "utf-8")).token || "";
  } catch {
    return "";
  }
}

export function saveToken(raw) {
  const token = normalizeToken(raw);
  if (!token) throw new KyivvodokanalTokenError("Empty token");
  const expiry = tokenExpiry(token);
  if (expiry && expiry <= new Date()) {
    throw new KyivvodokanalTokenError(`Token already expired at ${expiry.toISOString()}`);
  }
  writeFileSync(TOKEN_FILE, JSON.stringify({ token, savedAt: new Date().toISOString() }), "utf-8");
  return { token, expiry };
}

// Returns the usable token with the latest expiry, or "" if none.
export function currentToken(configToken) {
  let fromConfig = "";
  try {
    fromConfig = normalizeToken(configToken);
  } catch {
    // An invalid config value is reported once at scheduler startup.
  }
  const candidates = [fromConfig, loadStoredToken()].filter(Boolean);
  candidates.sort((a, b) => (tokenExpiry(b)?.getTime() ?? 0) - (tokenExpiry(a)?.getTime() ?? 0));
  return candidates[0] || "";
}
