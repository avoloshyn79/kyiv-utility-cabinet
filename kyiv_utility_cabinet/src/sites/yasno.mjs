// Logs into the YASNO personal cabinet using a real headless Chromium (Playwright) -
// the same approach the official mobile app uses via its embedded WebView - and
// returns the resulting app.yasno.ua session cookie string.
//
// Heavily logged on purpose: this flow depends on a third-party SPA and a
// real browser, so when it breaks the add-on's own log (visible from the
// Supervisor UI, no shell access needed) should say exactly what the page
// was doing at the time.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const DEBUG_DIR = "/data/debug";
const HEARTBEAT_MS = 8000;

function log(message) {
  console.log(`[${new Date().toISOString()}] [yasno:login] ${message}`);
}

function attachPageDiagnostics(page) {
  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "error" || type === "warning") {
      log(`page console [${type}]: ${msg.text().slice(0, 300)}`);
    }
  });
  page.on("pageerror", (err) => log(`page error: ${err.message.slice(0, 300)}`));
  page.on("requestfailed", (req) => {
    log(`request failed: ${req.method()} ${req.url()} - ${req.failure()?.errorText ?? "unknown reason"}`);
  });
  page.on("response", (res) => {
    if (res.status() >= 400) log(`response ${res.status()}: ${res.url()}`);
  });
}

// Logs page.url()/title() every HEARTBEAT_MS while `promise` is pending, so
// a long wait shows up as periodic progress instead of going silent until
// the final timeout. Returns whatever `promise` resolves/rejects to.
async function withHeartbeat(page, label, promise) {
  const timer = setInterval(() => {
    page
      .title()
      .catch(() => "(unavailable)")
      .then((title) => log(`still waiting (${label})... url=${page.url()} title="${title}"`));
  }, HEARTBEAT_MS);
  try {
    return await promise;
  } finally {
    clearInterval(timer);
  }
}

async function dismissOnboarding(page) {
  const modal = page.locator(".onboarding-modal__title").first();
  if (await modal.isVisible().catch(() => false)) {
    log("Onboarding modal present, dismissing...");
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);
    const closeBtn = page.locator("button:has(svg)").first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click().catch(() => {});
    }
    await page.waitForTimeout(300);
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
    } else {
      log("No known bot-protection markers found in HTML.");
    }

    let bodyText = "";
    try {
      bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) ?? "");
    } catch {
      // ignore
    }
    log(`Visible body text (first 500 chars): ${JSON.stringify(bodyText)}`);
  } else {
    log("Page HTML was empty or unreadable.");
  }

  try {
    mkdirSync(DEBUG_DIR, { recursive: true });
    await page.screenshot({ path: `${DEBUG_DIR}/yasno-last-failure.png`, fullPage: true }).catch(() => {});
    writeFileSync(`${DEBUG_DIR}/yasno-last-failure.html`, html, "utf-8");
    writeFileSync(
      `${DEBUG_DIR}/yasno-last-failure.txt`,
      `time: ${new Date().toISOString()}\nurl: ${url}\ntitle: ${title}\nerror: ${err.message}\n`,
      "utf-8"
    );
    log("Saved screenshot/html/info to /data/debug/ (GET /debug/yasno/{screenshot,html,info}).");
  } catch (e) {
    log(`Could not save debug artifacts to disk: ${e.message}`);
  }

  err.message = `${err.message} (stuck at ${url}, title="${title}")`;
  return err;
}

// Common site-module interface: login(credentials) -> Promise<{ cookie: string }>
export async function login({ phone, password }) {
  log("Launching headless Chromium...");
  const browser = await chromium.launch({ headless: true });
  log(`Chromium launched. Version: ${browser.version()}`);
  const context = await browser.newContext({
    locale: "uk-UA",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  attachPageDiagnostics(page);

  try {
    log("Navigating to https://yasno.ua/my/ ...");
    const response = await page.goto("https://yasno.ua/my/", { waitUntil: "domcontentloaded", timeout: 60000 });
    log(`Navigation done: HTTP ${response?.status() ?? "?"}, url=${page.url()}`);

    // waitUntil defaults to "load" (all resources), which a heavy SPA can
    // miss on slow hardware even though the redirect itself already
    // happened - "commit" only waits for the URL to actually change.
    log("Waiting for client-side redirect to login.yasno.ua...");
    await withHeartbeat(
      page,
      "redirect to login.yasno.ua",
      page.waitForURL(/login\.yasno\.ua/, { timeout: 45000, waitUntil: "commit" })
    );
    log(`Redirected. url=${page.url()}`);
    await page.waitForLoadState("networkidle", { timeout: 45000 }).catch((e) => log(`networkidle wait: ${e.message}`));

    await dismissOnboarding(page);

    log("Filling phone number...");
    const usernameInput = page.locator("input[name='username']");
    await usernameInput.waitFor({ state: "visible", timeout: 15000 });
    await usernameInput.fill(phone);
    await page.getByRole("button", { name: "Продовжити" }).click();

    log("Waiting for password field...");
    const passwordInput = page.locator("input[name='password']");
    await passwordInput.waitFor({ state: "visible", timeout: 15000 });
    log("Filling password and submitting...");
    await passwordInput.fill(password);
    await page.getByRole("button", { name: "Увійти" }).click();

    log("Waiting for redirect to personal-accounts...");
    await withHeartbeat(
      page,
      "redirect to personal-accounts",
      page.waitForURL(/yasno\.ua\/my\/personal-accounts/, { timeout: 45000, waitUntil: "commit" })
    );
    log(`Logged in. url=${page.url()}`);

    const cookies = await context.cookies("https://app.yasno.ua");
    if (cookies.length === 0) {
      throw new Error("Login appeared to succeed but no cookies were returned for app.yasno.ua");
    }
    log(`Got ${cookies.length} cookie(s) for app.yasno.ua.`);
    return { cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
  } catch (err) {
    throw await saveFailureArtifacts(page, err);
  } finally {
    await browser.close();
  }
}
