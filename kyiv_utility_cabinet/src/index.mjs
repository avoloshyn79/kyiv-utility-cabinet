import { readFileSync } from "node:fs";
import { startHttpServer } from "./server.mjs";
import { connectMqtt } from "./mqtt-publish.mjs";
import { startScheduler } from "./scheduler.mjs";
import { startKyivvodokanalSetupMode } from "./kyivvodokanal-setup.mjs";
import { setDebugEnabled, log as sharedLog } from "./logger.mjs";

const OPTIONS_PATH = "/data/options.json";

function log(message) {
  sharedLog("main", message);
}

function loadOptions() {
  try {
    return JSON.parse(readFileSync(OPTIONS_PATH, "utf-8"));
  } catch (err) {
    log(`Could not read ${OPTIONS_PATH}: ${err.message}. Using defaults.`);
    return {};
  }
}

function resolveMqttConfig(options) {
  // Manual options win when set; otherwise fall back to the connection
  // details Supervisor injects for a `services: [mqtt:want]` dependency.
  return {
    host: options.mqtt_host || process.env.MQTT_HOST || "core-mosquitto",
    port: Number(options.mqtt_port || process.env.MQTT_PORT || 1883),
    username: options.mqtt_username || process.env.MQTT_USERNAME || "",
    password: options.mqtt_password || process.env.MQTT_PASSWORD || "",
  };
}

function main() {
  const options = loadOptions();

  setDebugEnabled(options.debug);
  log(`Debug logging is ${options.debug ? "ON" : "off"}.`);

  startHttpServer(options.api_key || "");

  const setupModeOn = Boolean(options.kyivvodokanal?.setup_mode);
  if (setupModeOn) {
    log(
      "Kyivvodokanal setup_mode is ON: starting the one-time remote-desktop profile setup instead of normal " +
        "Kyivvodokanal polling. Turn setup_mode back off and restart the add-on once you're done."
    );
    startKyivvodokanalSetupMode(options);
  }

  const anyServiceEnabled = Boolean(options.yasno?.enabled) || (Boolean(options.kyivvodokanal?.enabled) && !setupModeOn);
  if (!anyServiceEnabled) {
    log("No service is enabled in the add-on configuration - only the manual HTTP API is running.");
    return;
  }

  const mqttConfig = resolveMqttConfig(options);
  const mqttClient = connectMqtt(mqttConfig, (msg) => log(msg));

  // While setup_mode is on, a plain (non-automated) Chromium is holding the
  // Kyivvodokanal profile directory open for the interactive login - a
  // Playwright-driven login against that same directory at the same time
  // would collide with it. Suppress just the Kyivvodokanal scheduler in
  // that case; YASNO keeps running normally.
  const schedulerOptions = setupModeOn
    ? { ...options, kyivvodokanal: { ...options.kyivvodokanal, enabled: false } }
    : options;
  startScheduler(mqttClient, schedulerOptions);
}

main();
