// Logs into the YASNO personal cabinet using a real headless Chromium (Playwright) -
// the same approach the official mobile app uses via its embedded WebView - and
// returns the resulting app.yasno.ua session cookie string.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const DEBUG_DIR = "/data/debug";

async function dismissOnboarding(page) {
  const modal = page.locator(".onboarding-modal__title").first();
  if (await modal.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);
    const closeBtn = page.locator("button:has(svg)").first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click().catch(() => {});
    }
    await page.waitForTimeout(300);
  }
}

async function saveFailureArtifacts(page, err) {
  try {
    mkdirSync(DEBUG_DIR, { recursive: true });
    const url = page.url();
    const title = await page.title().catch(() => "(unavailable)");
    await page.screenshot({ path: `${DEBUG_DIR}/yasno-last-failure.png`, fullPage: true }).catch(() => {});
    const html = await page.content().catch(() => "");
    writeFileSync(`${DEBUG_DIR}/yasno-last-failure.html`, html, "utf-8");
    writeFileSync(
      `${DEBUG_DIR}/yasno-last-failure.txt`,
      `time: ${new Date().toISOString()}\nurl: ${url}\ntitle: ${title}\nerror: ${err.message}\n`,
      "utf-8"
    );
    err.message = `${err.message} (stuck at ${url}, title="${title}" - see GET /debug/yasno for details)`;
  } catch {
    // Best-effort diagnostics only - never let this hide the original error.
  }
  return err;
}

// Common site-module interface: login(credentials) -> Promise<{ cookie: string }>
export async function login({ phone, password }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "uk-UA",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    await page.goto("https://yasno.ua/my/", { waitUntil: "domcontentloaded", timeout: 60000 });
    // waitUntil defaults to "load" (all resources), which a heavy SPA can
    // miss on slow hardware even though the redirect itself already
    // happened - "commit" only waits for the URL to actually change.
    await page.waitForURL(/login\.yasno\.ua/, { timeout: 45000, waitUntil: "commit" });
    await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});

    await dismissOnboarding(page);

    const usernameInput = page.locator("input[name='username']");
    await usernameInput.waitFor({ state: "visible", timeout: 15000 });
    await usernameInput.fill(phone);
    await page.getByRole("button", { name: "Продовжити" }).click();

    const passwordInput = page.locator("input[name='password']");
    await passwordInput.waitFor({ state: "visible", timeout: 15000 });
    await passwordInput.fill(password);
    await page.getByRole("button", { name: "Увійти" }).click();

    await page.waitForURL(/yasno\.ua\/my\/personal-accounts/, { timeout: 45000, waitUntil: "commit" });

    const cookies = await context.cookies("https://app.yasno.ua");
    if (cookies.length === 0) {
      throw new Error("Login appeared to succeed but no cookies were returned for app.yasno.ua");
    }
    return { cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
  } catch (err) {
    throw await saveFailureArtifacts(page, err);
  } finally {
    await browser.close();
  }
}
