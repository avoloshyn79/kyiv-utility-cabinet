// Logs into the Kyivvodokanal personal cabinet using a real headless
// Chromium (Playwright), the same approach as yasno.mjs. The one real
// difference: this login page has a Google reCAPTCHA v2 checkbox. This
// code clicks it once, like a real user would - it does NOT attempt to
// solve an image/audio challenge if one appears, and does not patch the
// browser to hide that it's automation-controlled. If reCAPTCHA decides to
// challenge the login, it fails with a clear error instead of retrying
// blindly - whether the plain checkbox click is accepted appears to depend
// heavily on signals Google sees across logins: a brand-new, cookie-less
// browser profile looks far more suspicious than one with an actual history.
//
// To help with that, this uses a *persistent* Chromium profile stored under
// /data/ instead of a fresh throwaway one per login - Google's own cookies
// (recaptcha risk cookies included) accumulate across runs the same way
// they would in a real browser you keep reusing, rather than every login
// looking like a brand-new device to Google.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { debugLog } from "../logger.mjs";

const DEBUG_DIR = "/data/debug";
const PROFILE_DIR = "/data/kyivvodokanal-chrome-profile";
const POLL_MS = 500;
const HEARTBEAT_MS = 8000;
const LOGIN_URL = "https://my.vodokanal.kiev.ua/sign-in";

export class KyivvodokanalCaptchaError extends Error {}

function log(message) {
  console.log(`[${new Date().toISOString()}] [kyivvodokanal:login] ${message}`);
}

function stepLog(message) {
  debugLog("kyivvodokanal:login", message);
}

function attachPageDiagnostics(page) {
  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "error" || type === "warning") {
      stepLog(`page console [${type}]: ${msg.text().slice(0, 300)}`);
    }
  });
  page.on("pageerror", (err) => stepLog(`page error: ${err.message.slice(0, 300)}`));
  page.on("requestfailed", (req) => {
    stepLog(`request failed: ${req.method()} ${req.url()} - ${req.failure()?.errorText ?? "unknown reason"}`);
  });
  page.on("response", (res) => {
    if (res.status() >= 400) stepLog(`response ${res.status()}: ${res.url()}`);
  });
}

async function bodyText(page) {
  return page
    .evaluate(() => document.body?.innerText?.replace(/\s+/g, " ").trim() ?? "")
    .catch(() => "");
}

// Clicks the reCAPTCHA v2 checkbox once, like a real user, and waits briefly
// to see whether Google accepted it outright or escalated to an image/audio
// challenge (the bframe). Does not attempt the challenge itself.
async function clickRecaptchaCheckbox(page) {
  const anchorFrame = page.frameLocator("iframe[src*='recaptcha/api2/anchor']");
  const checkbox = anchorFrame.locator("#recaptcha-anchor");
  await checkbox.waitFor({ state: "visible", timeout: 15000 });

  stepLog("Clicking reCAPTCHA checkbox...");
  await checkbox.click();

  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const checked = (await checkbox.getAttribute("aria-checked").catch(() => null)) === "true";
    if (checked) {
      stepLog("reCAPTCHA checkbox accepted.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new KyivvodokanalCaptchaError(
    "reCAPTCHA presented an additional challenge (image/audio) instead of accepting the checkbox. " +
      "This add-on only clicks the checkbox like a real user - it does not solve challenges. Whether this " +
      "happens can depend on the network's reputation with Google; it may behave differently on another network."
  );
}

// Polls until the URL leaves /sign-in (success) or the timeout elapses.
// Logs a heartbeat while waiting, same idea as yasno.mjs's waitForOutcome.
async function waitForRedirectAwayFromSignIn(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastHeartbeatAt = 0;

  while (true) {
    if (!page.url().includes("/sign-in")) return;

    if (Date.now() >= deadline) {
      throw new Error("Timeout waiting for redirect away from /sign-in");
    }

    if (Date.now() - lastHeartbeatAt > HEARTBEAT_MS) {
      lastHeartbeatAt = Date.now();
      const title = await page.title().catch(() => "(unavailable)");
      const text = await bodyText(page);
      stepLog(`still waiting (redirect away from /sign-in)... url=${page.url()} title="${title}" text="${text.slice(0, 150)}"`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

const BOT_PROTECTION_MARKERS = ["incapsula", "_incap_", "distil", "checking your browser", "captcha", "cloudflare"];

async function saveFailureArtifacts(page, err) {
  const url = page.url();
  const title = await page.title().catch(() => "(unavailable)");
  log(`FAILURE SNAPSHOT: url=${url} title="${title}"`);

  let html = "";
  try {
    html = await page.content();
  } catch (e) {
    log(`Could not read page content: ${e.message}`);
  }

  if (html) {
    log(`Page HTML length: ${html.length} chars`);
    const lower = html.toLowerCase();
    const foundMarkers = BOT_PROTECTION_MARKERS.filter((m) => lower.includes(m));
    if (foundMarkers.length > 0) {
      log(`Bot-protection markers found in HTML: ${foundMarkers.join(", ")}`);
    }
    const text = await bodyText(page);
    log(`Visible body text (first 250 chars): ${JSON.stringify(text.slice(0, 250))}`);
  } else {
    log("Page HTML was empty or unreadable.");
  }

  try {
    mkdirSync(DEBUG_DIR, { recursive: true });
    await page.screenshot({ path: `${DEBUG_DIR}/kyivvodokanal-last-failure.png`, fullPage: true }).catch(() => {});
    writeFileSync(`${DEBUG_DIR}/kyivvodokanal-last-failure.html`, html, "utf-8");
    writeFileSync(
      `${DEBUG_DIR}/kyivvodokanal-last-failure.txt`,
      `time: ${new Date().toISOString()}\nurl: ${url}\ntitle: ${title}\nerror: ${err.message}\n`,
      "utf-8"
    );
    log("Saved screenshot/html/info to /data/debug/ (GET /debug/kyivvodokanal/{screenshot,html,info}).");
  } catch (e) {
    log(`Could not save debug artifacts to disk: ${e.message}`);
  }

  err.message = `${err.message} (stuck at ${url}, title="${title}")`;
  return err;
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;

async function loginWithRetries({ email, password }) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      log(`Retrying login (attempt ${attempt}/${MAX_ATTEMPTS}) after a transient failure...`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
    try {
      return await attemptLogin({ email, password });
    } catch (err) {
      lastErr = err;
      log(`Attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err.message}`);
      if (err instanceof KyivvodokanalCaptchaError) {
        log("Not retrying: reCAPTCHA challenged this attempt, retrying immediately won't change that.");
        break;
      }
    }
  }
  throw lastErr;
}

// The persistent profile directory (see the file header) can only be opened
// by one Chromium instance at a time - a second `launchPersistentContext`
// against the same directory while one is already open would fail outright.
// The scheduler already serializes its own login calls, but the manual
// POST /fetch/kyivvodokanal HTTP API calls login() directly and could land
// at the same time. Queueing every call through this module-level chain
// guarantees only one login ever touches the profile directory at once,
// regardless of caller.
let loginQueue = Promise.resolve();

// Common site-module interface: login(credentials) -> Promise<{ cookie: string }>
export function login({ email, password }) {
  const run = loginQueue.then(() => loginWithRetries({ email, password }));
  loginQueue = run.catch(() => {});
  return run;
}

async function attemptLogin({ email, password }) {
  stepLog(`Launching headless Chromium with persistent profile at ${PROFILE_DIR}...`);
  mkdirSync(PROFILE_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    locale: "uk-UA",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  attachPageDiagnostics(page);

  try {
    stepLog(`Navigating to ${LOGIN_URL} ...`);
    await page.goto(LOGIN_URL, { waitUntil: "networkidle", timeout: 60000 });

    stepLog("Filling email and password...");
    await page.locator("#account").fill(email);
    await page.locator("input[type='password']").fill(password);

    await clickRecaptchaCheckbox(page);

    stepLog("Waiting for the submit button to become enabled...");
    const submitBtn = page.getByRole("button", { name: "Увійти" });
    await page
      .waitForFunction(() => {
        const btn = document.querySelector("button[type='submit']");
        return btn && !btn.disabled;
      }, { timeout: 10000 })
      .catch(() => stepLog("Submit button never reported enabled - trying to click anyway."));

    stepLog("Submitting login form...");
    await submitBtn.click();

    stepLog("Waiting for redirect away from /sign-in...");
    await waitForRedirectAwayFromSignIn(page, 30000);
    stepLog(`Logged in. url=${page.url()}`);

    const cookies = await context.cookies("https://my.vodokanal.kiev.ua");
    if (cookies.length === 0) {
      throw new Error("Login appeared to succeed but no cookies were returned for my.vodokanal.kiev.ua");
    }
    stepLog(`Got ${cookies.length} cookie(s) for my.vodokanal.kiev.ua.`);
    return { cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
  } catch (err) {
    throw await saveFailureArtifacts(page, err);
  } finally {
    await context.close();
  }
}
