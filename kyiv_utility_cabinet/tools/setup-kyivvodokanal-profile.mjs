// One-time interactive setup for Kyivvodokanal's reCAPTCHA problem: opens a
// real, VISIBLE Chromium window (not headless) using the same kind of
// persistent profile the add-on's headless login reuses
// (src/sites/kyivvodokanal.mjs), so you can log into your Google account -
// and, while you're there, Kyivvodokanal itself - as a real person, once.
//
// Why this helps: a browser profile with an actual signed-in Google session
// is one of the strongest positive signals reCAPTCHA v2 looks at. The
// add-on's own headless logins can't establish that themselves (Google's
// sign-in has its own strong bot defenses - automating email+password into
// it risks the account getting flagged, and breaks outright with 2FA), so
// this has to be a genuine human action, done once, in a browser you can
// actually see.
//
// Usage (run from inside kyiv_utility_cabinet/, so it picks up the
// playwright install already there):
//   node tools/setup-kyivvodokanal-profile.mjs [output-dir]
//
// If you haven't already: npm install && npx playwright install chromium
//
// Defaults to a folder under your OS temp directory so nothing lands in
// this git repo by accident - it will contain real session cookies.
//
// When you're done (logged into Google, and into
// https://my.vodokanal.kiev.ua/sign-in if you want), just close the browser
// window. Then copy the WHOLE output folder onto the add-on's persistent
// storage at exactly:
//   /data/kyivvodokanal-chrome-profile
// (e.g. via the Samba share or SSH & Web Terminal add-ons), replacing
// whatever the add-on already created there, and restart the add-on.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const outDir = path.resolve(process.argv[2] || path.join(tmpdir(), "kyivvodokanal-chrome-profile"));
mkdirSync(outDir, { recursive: true });

console.log(`Profile folder: ${outDir}`);
console.log("");
console.log("1. In the window that opens, log into your Google account normally.");
console.log("2. Then go to https://my.vodokanal.kiev.ua/sign-in and log in there too (solve the captcha as usual).");
console.log("3. When you're done, just close the browser window - this script exits on its own.");
console.log("");

const context = await chromium.launchPersistentContext(outDir, {
  headless: false,
  locale: "uk-UA",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
});

const page = context.pages()[0] ?? (await context.newPage());
await page.goto("https://accounts.google.com/", { waitUntil: "domcontentloaded" });

await new Promise((resolve) => context.on("close", resolve));

console.log(`Done. Profile saved to: ${outDir}`);
console.log("Copy this whole folder to the add-on's /data/kyivvodokanal-chrome-profile and restart the add-on.");
