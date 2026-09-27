import { readFileSync } from "node:fs";
import { startHttpServer } from "./server.mjs";
import { connectMqtt } from "./mqtt-publish.mjs";
import { startScheduler } from "./scheduler.mjs";
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

  const anyServiceEnabled = Boolean(options.yasno?.enabled);
  if (!anyServiceEnabled) {
    log("No service is enabled in the add-on configuration - only the manual HTTP API is running.");
    return;
  }

  const mqttConfig = resolveMqttConfig(options);
  const mqttClient = connectMqtt(mqttConfig, (msg) => log(msg));
  startScheduler(mqttClient, options);
}

main();
