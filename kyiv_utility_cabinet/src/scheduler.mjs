// Runs one polling loop per enabled utility service: log in (real headless
// Chromium), fetch account data with the resulting cookie, publish it to
// Home Assistant over MQTT. Each service keeps its own last-known cookie in
// memory and only re-logs in when a call comes back unauthenticated.
import { login as yasnoLogin } from "./sites/yasno.mjs";
import { fetchAccountData, YasnoAuthError } from "./sites/yasno-data.mjs";
import { publishYasnoData } from "./mqtt-publish.mjs";

function log(service, message) {
  console.log(`[${new Date().toISOString()}] [${service}] ${message}`);
}

async function pollYasno(mqttClient, config, state) {
  try {
    if (!state.cookie) {
      log("yasno", "Logging in...");
      const { cookie } = await yasnoLogin({ phone: config.phone, password: config.password });
      state.cookie = cookie;
      log("yasno", "Login OK.");
    }

    let data;
    try {
      data = await fetchAccountData(state.cookie);
    } catch (err) {
      if (!(err instanceof YasnoAuthError)) throw err;
      log("yasno", "Session expired, re-logging in...");
      const { cookie } = await yasnoLogin({ phone: config.phone, password: config.password });
      state.cookie = cookie;
      data = await fetchAccountData(state.cookie);
    }

    publishYasnoData(mqttClient, {
      discoveryPrefix: config.discoveryPrefix,
      deviceId: "yasno_cabinet",
      deviceName: "YASNO Cabinet",
      data,
    });
    log("yasno", `Published. Balance=${data.balance} Debt=${data.debt}`);
  } catch (err) {
    log("yasno", `FAILED: ${err.message}`);
  }
}

/**
 * @param {import('mqtt').MqttClient} mqttClient
 * @param {object} options - the add-on's /data/options.json contents
 */
export function startScheduler(mqttClient, options) {
  const discoveryPrefix = options.discovery_prefix || "homeassistant";

  if (options.yasno?.enabled) {
    const config = {
      phone: options.yasno.phone,
      password: options.yasno.password,
      discoveryPrefix,
    };
    const state = { cookie: "" };
    const intervalMs = Math.max(5, Number(options.yasno.interval_minutes) || 1440) * 60 * 1000;

    log("yasno", `Scheduler starting, polling every ${intervalMs / 60000} minute(s).`);
    pollYasno(mqttClient, config, state);
    setInterval(() => pollYasno(mqttClient, config, state), intervalMs);
  }

  // Future services (Kyivvodokanal, Kyivteploenergo, Kyivgaz) plug in here
  // the same way, once their site modules exist under ./sites/.
}
