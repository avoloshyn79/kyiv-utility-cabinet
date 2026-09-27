// One-time interactive setup for Kyivvodokanal's reCAPTCHA problem, run
// inside the add-on itself via a remote desktop (noVNC) - see DOCS.md's
// "Kyivvodokanal and reCAPTCHA" section for why this exists:
//   - Google refuses to let a CDP-automated browser (which is exactly what
//     Playwright's launch()/launchPersistentContext() produce) sign into a
//     Google account at all - it shows "This browser or app may not be
//     secure" and blocks the attempt outright, regardless of using real
//     Chrome or a stealth patch would be needed to get around it, which
//     this project won't do.
//   - Logging in on your own computer and copying the profile over doesn't
//     work either: Chrome's cookie encryption on Windows (DPAPI) is tied to
//     that specific Windows user/machine and simply can't be decrypted once
//     copied onto this Linux container.
//
// The fix: launch Playwright's own bundled Chromium binary directly as a
// plain OS process - not through any Playwright API, no
// --remote-debugging-port, no CDP client ever attached - so it behaves
// exactly like an ordinary browser a person is using, with no automation
// signal for Google to detect. It's shown on a virtual display (Xvfb) and
// made reachable through a browser tab via x11vnc + noVNC/websockify, so
// you interact with it using your actual mouse and keyboard, not an
// automation API.
//
// The profile directory this writes to is the exact same one
// kyivvodokanal.mjs's headless, Playwright-driven logins reuse afterward -
// only this one, one-time Google sign-in needs to avoid CDP entirely;
// Kyivvodokanal's own site only has reCAPTCHA (handled honestly elsewhere
// in kyivvodokanal.mjs), not a blanket ban on automation.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { log } from "./logger.mjs";

const COMPONENT = "kyivvodokanal:setup";
const PROFILE_DIR = "/data/kyivvodokanal-chrome-profile";
const DISPLAY = ":99";
const SCREEN_GEOMETRY = "1280x800x24";
const VNC_PORT = 5900;
const NOVNC_PORT = 6080;

function spawnLogged(name, command, args, extraEnv) {
  log(COMPONENT, `Starting ${name}: ${command} ${args.join(" ")}`);
  const child = spawn(command, args, { env: { ...process.env, ...extraEnv } });
  child.stdout?.on("data", (d) => log(COMPONENT, `[${name}] ${d.toString().trim()}`));
  child.stderr?.on("data", (d) => log(COMPONENT, `[${name}] ${d.toString().trim()}`));
  child.on("error", (err) => log(COMPONENT, `[${name}] failed to start: ${err.message}`));
  child.on("exit", (code, signal) => log(COMPONENT, `[${name}] exited (code=${code}, signal=${signal}).`));
  return child;
}

// Classic VNC/RFB authentication (what x11vnc's -passwd uses) is a
// DES-based scheme that only has room for 8 bytes of password - not this
// add-on's choice, just how the VNC protocol works. Longer api_key values
// still work as the source, just truncated for this purpose.
function vncPasswordFrom(apiKey) {
  return apiKey.slice(0, 8);
}

export async function startKyivvodokanalSetupMode(options) {
  const apiKey = options.api_key || "";
  if (!apiKey) {
    log(
      COMPONENT,
      "Refusing to start: set an api_key in the add-on configuration first. It's reused as the VNC password " +
        "so this remote desktop isn't left reachable to anyone on the network without one."
    );
    return;
  }

  mkdirSync(PROFILE_DIR, { recursive: true });

  const children = [];
  children.push(spawnLogged("Xvfb", "Xvfb", [DISPLAY, "-screen", "0", SCREEN_GEOMETRY]));

  // Give the virtual X server a moment to actually start listening before
  // Chromium and x11vnc try to connect to it.
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const chromiumPath = chromium.executablePath();
  log(COMPONENT, `Launching a plain, non-automated Chromium (no CDP attached) at ${chromiumPath}...`);
  children.push(
    spawnLogged(
      "chromium",
      chromiumPath,
      [
        `--user-data-dir=${PROFILE_DIR}`,
        "--no-first-run",
        "--start-maximized",
        "--window-position=0,0",
        "https://accounts.google.com/",
      ],
      { DISPLAY }
    )
  );

  const vncPassword = vncPasswordFrom(apiKey);
  children.push(
    spawnLogged("x11vnc", "x11vnc", [
      "-display",
      DISPLAY,
      "-forever",
      "-shared",
      "-rfbport",
      String(VNC_PORT),
      "-passwd",
      vncPassword,
    ])
  );

  children.push(
    spawnLogged("websockify", "websockify", ["--web=/usr/share/novnc/", String(NOVNC_PORT), `localhost:${VNC_PORT}`])
  );

  log(
    COMPONENT,
    `Setup mode is running. Open this add-on's Web UI (or http://<home-assistant-ip>:${NOVNC_PORT}/vnc.html), ` +
      "connect with the VNC password (the first 8 characters of your api_key), log into your Google account, " +
      "then go to https://my.vodokanal.kiev.ua/sign-in and log in there too. When you're done, turn " +
      "kyivvodokanal.setup_mode back off in the add-on configuration and restart it."
  );

  const shutdown = () => {
    log(COMPONENT, "Add-on stopping - shutting down setup mode processes...");
    for (const child of children) child.kill();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
