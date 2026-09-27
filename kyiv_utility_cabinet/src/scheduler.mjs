// Runs one polling loop per enabled utility service: log in (real headless
// Chromium), fetch account data with the resulting cookie, publish it to
// Home Assistant over MQTT. Each service keeps its own last-known cookie in
// memory and only re-logs in when a call comes back unauthenticated.
//
// Separately, if meter reading submission is enabled, an hourly check looks
// for the configured day of month and - the first time it sees it each
// month - reads the current reading(s) from Home Assistant entities and
// submits them to YASNO. This runs on its own timer (not the data-refresh
// interval above) so it still fires reliably even if interval_minutes is
// set to something long like a week.
import { readFileSync, writeFileSync } from "node:fs";
import { login as yasnoLogin } from "./sites/yasno.mjs";
import { fetchAccountData, submitMeterReadings, YasnoAuthError } from "./sites/yasno-data.mjs";
import { publishYasnoData, publishYasnoSubmitButton } from "./mqtt-publish.mjs";
import { getEntityStateAsNumber } from "./ha-api.mjs";

const SUBMISSION_STATE_FILE = "/data/kyiv-utility-cabinet-submissions.json";
const SUBMISSION_CHECK_INTERVAL_MS = 60 * 60 * 1000;

function log(service, message) {
  console.log(`[${new Date().toISOString()}] [${service}] ${message}`);
}

// Guards against the poll loop and the submission check both starting a
// login at the same moment (they run on independent timers and can land on
// the same tick, e.g. right at add-on startup) by sharing one in-flight
// login promise instead of each kicking off its own browser.
async function ensureLoggedIn(config, state) {
  if (state.cookie) return state.cookie;
  if (!state.loginPromise) {
    log("yasno", "Logging in...");
    state.loginPromise = yasnoLogin({ phone: config.phone, password: config.password })
      .then(({ cookie }) => {
        state.cookie = cookie;
        log("yasno", "Login OK.");
        return cookie;
      })
      .finally(() => {
        state.loginPromise = null;
      });
  }
  return state.loginPromise;
}

async function pollYasno(mqttClient, config, state) {
  try {
    await ensureLoggedIn(config, state);

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

    state.lastData = data;
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

function loadSubmissionState() {
  try {
    return JSON.parse(readFileSync(SUBMISSION_STATE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveSubmissionState(submissionState) {
  try {
    writeFileSync(SUBMISSION_STATE_FILE, JSON.stringify(submissionState));
  } catch (err) {
    log("yasno", `Could not persist meter reading submission state: ${err.message}`);
  }
}

function currentYearMonth(now) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// Two-zone (day/night) vs single-zone, same rule as the sensor-visibility
// logic in the ha-yasno-cabinet integration this add-on replaced.
function resolveMeterIsDayNight(submitConfig, lastData) {
  if (submitConfig.meterType === "single") return false;
  if (submitConfig.meterType === "day_night") return true;
  return lastData?.tariff_price_night != null || lastData?.meter_reading_night != null;
}

async function buildMeteringReadings(submitConfig, isDayNight, zoneNames) {
  if (isDayNight) {
    const [dayValue, nightValue] = await Promise.all([
      getEntityStateAsNumber(submitConfig.entityDay),
      getEntityStateAsNumber(submitConfig.entityNight),
    ]);
    return [
      { zone: zoneNames?.day || "Day", value: dayValue },
      { zone: zoneNames?.night || "Night", value: nightValue },
    ];
  }
  const value = await getEntityStateAsNumber(submitConfig.entitySingle);
  return [{ zone: zoneNames?.alltime || "Alltime", value }];
}

// Does the actual login + read-entities + submit work, recording the month
// so the scheduled check (below) won't also submit again. Shared by the
// scheduled day-of-month check and the manual "Submit meter reading now"
// MQTT button - the button ignores the day/once-per-month gating since a
// press is an explicit request, but still records the month afterwards.
async function submitYasnoReadingNow(config, state) {
  if (state.submitInProgress) {
    log("yasno", "Meter reading submission already in progress, ignoring this request.");
    return;
  }
  state.submitInProgress = true;

  try {
    const submitConfig = config.submitReadings;
    await ensureLoggedIn(config, state);
    if (!state.lastData) {
      state.lastData = await fetchAccountData(state.cookie);
    }

    const isDayNight = resolveMeterIsDayNight(submitConfig, state.lastData);
    const readings = await buildMeteringReadings(submitConfig, isDayNight, state.lastData.meter_reading_zone_names);

    const yearMonth = currentYearMonth(new Date());
    log("yasno", `Submitting meter reading(s) for ${yearMonth}: ${JSON.stringify(readings)}`);
    await submitMeterReadings(state.cookie, state.lastData.account_id, readings);
    log("yasno", "Meter reading submitted.");

    const submissionState = loadSubmissionState();
    submissionState.yasno = yearMonth;
    saveSubmissionState(submissionState);
  } catch (err) {
    if (err instanceof YasnoAuthError) {
      state.cookie = "";
    }
    log("yasno", `Meter reading submission FAILED: ${err.message}`);
  } finally {
    state.submitInProgress = false;
  }
}

async function checkAndSubmitYasnoReading(config, state) {
  const submitConfig = config.submitReadings;
  if (!submitConfig?.enabled) return;

  const now = new Date();
  if (now.getDate() !== submitConfig.dayOfMonth) return;

  const submissionState = loadSubmissionState();
  if (submissionState.yasno === currentYearMonth(now)) return;

  await submitYasnoReadingNow(config, state);
}

/**
 * @param {import('mqtt').MqttClient} mqttClient
 * @param {object} options - the add-on's /data/options.json contents
 */
export function startScheduler(mqttClient, options) {
  const discoveryPrefix = options.discovery_prefix || "homeassistant";

  if (options.yasno?.enabled) {
    const submit = options.yasno.submit_readings || {};
    const config = {
      phone: options.yasno.phone,
      password: options.yasno.password,
      discoveryPrefix,
      submitReadings: {
        enabled: Boolean(submit.enabled),
        dayOfMonth: Number(submit.day_of_month) || 25,
        meterType: submit.meter_type || "auto",
        entitySingle: submit.entity_single || "",
        entityDay: submit.entity_day || "",
        entityNight: submit.entity_night || "",
      },
    };
    const state = { cookie: "", lastData: null, submitInProgress: false };
    const intervalMs = Math.max(5, Number(options.yasno.interval_minutes) || 1440) * 60 * 1000;

    log("yasno", `Scheduler starting, polling every ${intervalMs / 60000} minute(s).`);
    pollYasno(mqttClient, config, state);
    setInterval(() => pollYasno(mqttClient, config, state), intervalMs);

    if (config.submitReadings.enabled) {
      log(
        "yasno",
        `Meter reading submission enabled: day ${config.submitReadings.dayOfMonth} of each month, meter type "${config.submitReadings.meterType}".`
      );
      checkAndSubmitYasnoReading(config, state);
      setInterval(() => checkAndSubmitYasnoReading(config, state), SUBMISSION_CHECK_INTERVAL_MS);
    }

    const hasReadingEntities = Boolean(
      config.submitReadings.entitySingle || (config.submitReadings.entityDay && config.submitReadings.entityNight)
    );
    if (hasReadingEntities) {
      const commandTopic = publishYasnoSubmitButton(mqttClient, {
        discoveryPrefix,
        deviceId: "yasno_cabinet",
        deviceName: "YASNO Cabinet",
      });
      mqttClient.subscribe(commandTopic, (err) => {
        if (err) log("yasno", `Could not subscribe to ${commandTopic}: ${err.message}`);
      });
      mqttClient.on("message", (topic) => {
        if (topic !== commandTopic) return;
        log("yasno", "Manual meter reading submission requested via button.");
        submitYasnoReadingNow(config, state);
      });
      log("yasno", "Manual 'Submit meter reading now' button published.");
    }
  }

  // Future services (Kyivvodokanal, Kyivteploenergo, Kyivgaz) plug in here
  // the same way, once their site modules exist under ./sites/.
}
