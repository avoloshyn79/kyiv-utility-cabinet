// Minimal HTTP API:
//   POST /fetch/<site> { ...credentials } -> { cookie }   (login proxy, YASNO)
//   POST /token/kyivvodokanal { token }   -> stores the Kyivvodokanal access token
//   GET  /token/kyivvodokanal             -> token status (expiry only, never the token)
//   GET  /data/kyivvodokanal              -> live account data fetched with that token
// Login-proxy callers pass credentials on every request; nothing is stored
// for that path. (The scheduler in scheduler.mjs is the other caller of the
// same site modules, using credentials from the add-on's own configuration.)
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { login as yasnoLogin } from "./sites/yasno.mjs";
import { currentToken, saveToken, tokenExpiry, KyivvodokanalTokenError } from "./kyivvodokanal-token.mjs";
import { fetchKyivvodokanalNow } from "./scheduler.mjs";

const PORT = 8099;
const DEBUG_DIR = "/data/debug";

const SITES = {
  yasno: yasnoLogin,
};

function debugFilesFor(site) {
  return {
    [`/debug/${site}/screenshot`]: { file: `${DEBUG_DIR}/${site}-last-failure.png`, contentType: "image/png" },
    [`/debug/${site}/html`]: { file: `${DEBUG_DIR}/${site}-last-failure.html`, contentType: "text/html; charset=utf-8" },
    [`/debug/${site}/info`]: { file: `${DEBUG_DIR}/${site}-last-failure.txt`, contentType: "text/plain; charset=utf-8" },
  };
}

const DEBUG_FILES = { ...debugFilesFor("yasno") };

function log(message) {
  console.log(`[${new Date().toISOString()}] [http] ${message}`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function tokenStatus(token) {
  const expiry = tokenExpiry(token);
  return {
    configured: Boolean(token),
    expires_at: expiry?.toISOString() ?? null,
    hours_left: expiry ? Number(((expiry.getTime() - Date.now()) / 3_600_000).toFixed(1)) : null,
  };
}

/**
 * @param {{ apiKey: string, kyivvodokanalConfigToken: string, hooks: { onKyivvodokanalToken?: () => void } }} args
 *   hooks is filled in by index.mjs once the scheduler has started.
 */
export function startHttpServer({ apiKey, kyivvodokanalConfigToken, hooks }) {
  if (!apiKey) {
    log("WARNING: no api_key set in add-on configuration - anyone reachable on this network can call this API.");
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { ok: true, sites: [...Object.keys(SITES), "kyivvodokanal"] });
    }

    if (apiKey && req.headers["x-api-key"] !== apiKey) {
      return sendJson(res, 401, { error: "Missing or invalid X-Api-Key header" });
    }

    const debugFile = req.method === "GET" ? DEBUG_FILES[url.pathname] : undefined;
    if (debugFile) {
      try {
        statSync(debugFile.file);
        const body = readFileSync(debugFile.file);
        res.writeHead(200, { "Content-Type": debugFile.contentType, "Content-Length": body.length });
        return res.end(body);
      } catch {
        return sendJson(res, 404, { error: "No failure recorded yet for this site" });
      }
    }

    if (url.pathname === "/token/kyivvodokanal") {
      if (req.method === "GET") return sendJson(res, 200, tokenStatus(currentToken(kyivvodokanalConfigToken)));
      if (req.method !== "POST") return sendJson(res, 405, { error: "Use GET or POST" });
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (err) {
        return sendJson(res, 400, { error: `Invalid JSON body: ${err.message}` });
      }
      try {
        const { token } = saveToken(body.token);
        const status = tokenStatus(token);
        log(`Kyivvodokanal token saved (expires ${status.expires_at}).`);
        hooks.onKyivvodokanalToken?.();
        return sendJson(res, 200, status);
      } catch (err) {
        if (err instanceof KyivvodokanalTokenError) return sendJson(res, 400, { error: err.message });
        throw err;
      }
    }

    if (req.method === "GET" && url.pathname === "/data/kyivvodokanal") {
      try {
        return sendJson(res, 200, await fetchKyivvodokanalNow({ token: kyivvodokanalConfigToken }));
      } catch (err) {
        log(`Kyivvodokanal data request failed: ${err.message}`);
        return sendJson(res, 502, { error: err.message });
      }
    }

    if (req.method !== "POST" || !url.pathname.startsWith("/fetch/")) {
      return sendJson(res, 404, { error: "Not found" });
    }

    const site = url.pathname.slice("/fetch/".length);
    const loginFn = SITES[site];
    if (!loginFn) {
      return sendJson(res, 404, { error: `Unknown site '${site}'. Available: ${Object.keys(SITES).join(", ")}` });
    }

    let credentials;
    try {
      credentials = JSON.parse(await readBody(req));
    } catch (err) {
      return sendJson(res, 400, { error: `Invalid JSON body: ${err.message}` });
    }

    log(`Login request for site '${site}'...`);
    try {
      const result = await loginFn(credentials);
      log(`Login for '${site}' succeeded.`);
      return sendJson(res, 200, result);
    } catch (err) {
      log(`Login for '${site}' failed: ${err.message}`);
      return sendJson(res, 502, { error: err.message });
    }
  });

  server.listen(PORT, () => {
    log(`Kyiv Utility Cabinet HTTP API listening on :${PORT}.`);
  });

  return server;
}
