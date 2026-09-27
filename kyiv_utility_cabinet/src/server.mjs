// Minimal HTTP proxy: POST /fetch/<site> { ...credentials } -> { cookie }
// Each site module in ./sites implements login(credentials) -> { cookie }.
// No credentials are stored here for this path - manual/on-demand callers
// pass them in on every request. (The scheduler in scheduler.mjs is the
// other caller of these same site modules, using credentials from the
// add-on's own configuration.)
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { login as yasnoLogin } from "./sites/yasno.mjs";

const PORT = 8099;
const DEBUG_DIR = "/data/debug";

const SITES = {
  yasno: yasnoLogin,
};

const DEBUG_FILES = {
  "/debug/yasno/screenshot": { file: `${DEBUG_DIR}/yasno-last-failure.png`, contentType: "image/png" },
  "/debug/yasno/html": { file: `${DEBUG_DIR}/yasno-last-failure.html`, contentType: "text/html; charset=utf-8" },
  "/debug/yasno/info": { file: `${DEBUG_DIR}/yasno-last-failure.txt`, contentType: "text/plain; charset=utf-8" },
};

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

export function startHttpServer(apiKey) {
  if (!apiKey) {
    log("WARNING: no api_key set in add-on configuration - anyone reachable on this network can call the login proxy.");
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { ok: true, sites: Object.keys(SITES) });
    }

    const debugFile = req.method === "GET" ? DEBUG_FILES[url.pathname] : undefined;
    if (debugFile) {
      if (apiKey && req.headers["x-api-key"] !== apiKey) {
        return sendJson(res, 401, { error: "Missing or invalid X-Api-Key header" });
      }
      try {
        statSync(debugFile.file);
        const body = readFileSync(debugFile.file);
        res.writeHead(200, { "Content-Type": debugFile.contentType, "Content-Length": body.length });
        return res.end(body);
      } catch {
        return sendJson(res, 404, { error: "No failure recorded yet for this site" });
      }
    }

    if (req.method !== "POST" || !url.pathname.startsWith("/fetch/")) {
      return sendJson(res, 404, { error: "Not found" });
    }

    if (apiKey && req.headers["x-api-key"] !== apiKey) {
      return sendJson(res, 401, { error: "Missing or invalid X-Api-Key header" });
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
    log(`Kyiv Utility Cabinet HTTP API listening on :${PORT}. Sites: ${Object.keys(SITES).join(", ")}`);
  });

  return server;
}
