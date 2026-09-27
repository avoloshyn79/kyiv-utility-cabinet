// Logs into the YASNO personal cabinet using a real headless Chromium (Playwright) -
// the same approach the official mobile app uses via its embedded WebView - and
// returns the resulting app.yasno.ua session cookie string.
import { chromium } from "playwright";

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
    await page.waitForURL(/login\.yasno\.ua/, { timeout: 30000 });
    await page.waitForLoadState("networkidle").catch(() => {});

    await dismissOnboarding(page);

    const usernameInput = page.locator("input[name='username']");
    await usernameInput.waitFor({ state: "visible", timeout: 15000 });
    await usernameInput.fill(phone);
    await page.getByRole("button", { name: "Продовжити" }).click();

    const passwordInput = page.locator("input[name='password']");
    await passwordInput.waitFor({ state: "visible", timeout: 15000 });
    await passwordInput.fill(password);
    await page.getByRole("button", { name: "Увійти" }).click();

    await page.waitForURL(/yasno\.ua\/my\/personal-accounts/, { timeout: 30000 });

    const cookies = await context.cookies("https://app.yasno.ua");
    if (cookies.length === 0) {
      throw new Error("Login appeared to succeed but no cookies were returned for app.yasno.ua");
    }
    return { cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
  } finally {
    await browser.close();
  }
}
