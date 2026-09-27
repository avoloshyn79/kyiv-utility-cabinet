// Publishes account data to Home Assistant via MQTT discovery, one device
// per site. One retained /config message per sensor (sent once, or whenever
// the set of applicable sensors changes) and one retained /state message
// per poll.
import mqtt from "mqtt";

const YASNO_SENSORS = [
  { key: "balance", name: "Balance", unit: "UAH", state_class: "measurement", icon: "mdi:wallet" },
  { key: "debt", name: "Debt", unit: "UAH", state_class: "measurement", icon: "mdi:alert-circle-outline" },
  {
    key: "consumption_kwh",
    name: "Consumption",
    unit: "kWh",
    device_class: "energy",
    state_class: "total",
    icon: "mdi:lightning-bolt",
  },
  { key: "last_payment", name: "Last payment amount", unit: "UAH", state_class: "measurement", icon: "mdi:cash" },
  { key: "last_payment_date", name: "Last payment date", icon: "mdi:calendar-month-outline" },
  { key: "last_fee_date", name: "Last invoice date", icon: "mdi:calendar-month-outline" },
  { key: "tariff_name", name: "Tariff", icon: "mdi:script-text-outline" },
  {
    key: "tariff_price_day",
    name: "Tariff price (day)",
    unit: "UAH/kWh",
    state_class: "measurement",
    icon: "mdi:currency-uah",
  },
  {
    key: "tariff_price_night",
    name: "Tariff price (night)",
    unit: "UAH/kWh",
    state_class: "measurement",
    icon: "mdi:currency-uah",
  },
  {
    key: "tariff_price_single",
    name: "Tariff price",
    unit: "UAH/kWh",
    state_class: "measurement",
    icon: "mdi:currency-uah",
  },
  { key: "dso_name", name: "DSO", icon: "mdi:office-building" },
  {
    key: "meter_reading_day",
    name: "Meter reading (day)",
    unit: "kWh",
    state_class: "measurement",
    icon: "mdi:meter-electric",
  },
  {
    key: "meter_reading_night",
    name: "Meter reading (night)",
    unit: "kWh",
    state_class: "measurement",
    icon: "mdi:meter-electric",
  },
  {
    key: "meter_reading_alltime",
    name: "Meter reading (total)",
    unit: "kWh",
    state_class: "measurement",
    icon: "mdi:meter-electric",
  },
  { key: "meter_reading_date", name: "Meter reading date", icon: "mdi:calendar-month-outline" },
  { key: "account_number", name: "Account number", icon: "mdi:identifier" },
];

const KYIVVODOKANAL_SENSORS = [
  { key: "debt", name: "Debt", unit: "UAH", state_class: "measurement", icon: "mdi:alert-circle-outline" },
  { key: "amount_to_pay", name: "Amount to pay", unit: "UAH", state_class: "measurement", icon: "mdi:cash" },
  { key: "last_payment_date", name: "Last payment date", icon: "mdi:calendar-month-outline" },
  { key: "service_provider_name", name: "Water supplier", icon: "mdi:office-building" },
  {
    key: "tariff_cold_water",
    name: "Tariff (cold water)",
    unit: "UAH/m³",
    state_class: "measurement",
    icon: "mdi:currency-uah",
  },
  {
    key: "tariff_sewerage",
    name: "Tariff (sewerage)",
    unit: "UAH/m³",
    state_class: "measurement",
    icon: "mdi:currency-uah",
  },
  { key: "tariff_abone", name: "Tariff (subscription fee)", unit: "UAH", state_class: "measurement", icon: "mdi:currency-uah" },
  { key: "hot_water_counter_number", name: "Hot water meter number", icon: "mdi:identifier" },
  { key: "hot_water_counter_check_date", name: "Hot water meter check date", icon: "mdi:calendar-month-outline" },
  {
    key: "hot_water_counter_next_check_date",
    name: "Hot water meter next check date",
    icon: "mdi:calendar-month-outline",
  },
  {
    key: "hot_water_last_reading",
    name: "Hot water last reading",
    unit: "m³",
    device_class: "water",
    state_class: "total_increasing",
    icon: "mdi:water-thermometer",
  },
  {
    key: "hot_water_last_transmission_date",
    name: "Hot water last submitted date",
    icon: "mdi:calendar-month-outline",
  },
  { key: "cold_water_counter_number", name: "Cold water meter number", icon: "mdi:identifier" },
  { key: "cold_water_counter_check_date", name: "Cold water meter check date", icon: "mdi:calendar-month-outline" },
  {
    key: "cold_water_counter_next_check_date",
    name: "Cold water meter next check date",
    icon: "mdi:calendar-month-outline",
  },
  {
    key: "cold_water_last_reading",
    name: "Cold water last reading",
    unit: "m³",
    device_class: "water",
    state_class: "total_increasing",
    icon: "mdi:water",
  },
  {
    key: "cold_water_last_transmission_date",
    name: "Cold water last submitted date",
    icon: "mdi:calendar-month-outline",
  },
  { key: "last_transmission_date", name: "Last submitted reading date", icon: "mdi:calendar-month-outline" },
];

function deviceInfo(deviceId, deviceName, manufacturer) {
  return { identifiers: [deviceId], name: deviceName, manufacturer, model: "Personal Cabinet" };
}

function publishSensorData(client, { discoveryPrefix, deviceId, deviceName, manufacturer, sensors, data }) {
  const device = deviceInfo(deviceId, deviceName, manufacturer);

  for (const sensor of sensors) {
    const objectId = `${deviceId}_${sensor.key}`;
    const configTopic = `${discoveryPrefix}/sensor/${objectId}/config`;
    const stateTopic = `${discoveryPrefix}/sensor/${objectId}/state`;

    const configPayload = {
      name: sensor.name,
      unique_id: objectId,
      state_topic: stateTopic,
      device,
      icon: sensor.icon,
    };
    if (sensor.unit) configPayload.unit_of_measurement = sensor.unit;
    if (sensor.device_class) configPayload.device_class = sensor.device_class;
    if (sensor.state_class) configPayload.state_class = sensor.state_class;

    client.publish(configTopic, JSON.stringify(configPayload), { retain: true, qos: 1 });

    const value = data[sensor.key];
    const stateValue = value === null || value === undefined ? "" : String(value);
    client.publish(stateTopic, stateValue, { retain: true, qos: 1 });
  }
}

/**
 * Publishes a "Submit ... reading now" button via MQTT discovery and
 * returns the topic it listens on for a press. Manual counterpart to a
 * site's scheduled submission in scheduler.mjs - same submit logic,
 * triggered on demand instead of waiting for the configured day of month.
 * @returns {string} the command topic to subscribe to
 */
function publishSubmitButton(client, { discoveryPrefix, deviceId, deviceName, manufacturer, buttonName }) {
  const device = deviceInfo(deviceId, deviceName, manufacturer);
  const objectId = `${deviceId}_submit_reading`;
  const configTopic = `${discoveryPrefix}/button/${objectId}/config`;
  const commandTopic = `${discoveryPrefix}/button/${objectId}/set`;

  const configPayload = {
    name: buttonName,
    unique_id: objectId,
    command_topic: commandTopic,
    payload_press: "PRESS",
    device,
    icon: "mdi:upload",
  };
  client.publish(configTopic, JSON.stringify(configPayload), { retain: true, qos: 1 });

  return commandTopic;
}

export function connectMqtt({ host, port, username, password }, onLog) {
  const client = mqtt.connect(`mqtt://${host}:${port}`, {
    username: username || undefined,
    password: password || undefined,
    reconnectPeriod: 5000,
    clientId: `kyiv_utility_cabinet_${Math.random().toString(16).slice(2)}`,
  });
  client.on("connect", () => onLog?.(`Connected to MQTT broker at ${host}:${port}`));
  client.on("error", (err) => onLog?.(`MQTT error: ${err.message}`));
  client.on("reconnect", () => onLog?.("Reconnecting to MQTT broker..."));
  return client;
}

/**
 * @param {import('mqtt').MqttClient} client
 * @param {{ discoveryPrefix: string, deviceId: string, deviceName: string, data: Record<string, unknown> }} args
 */
export function publishYasnoData(client, { discoveryPrefix, deviceId, deviceName, data }) {
  publishSensorData(client, { discoveryPrefix, deviceId, deviceName, manufacturer: "YASNO", sensors: YASNO_SENSORS, data });
}

export function publishYasnoSubmitButton(client, { discoveryPrefix, deviceId, deviceName }) {
  return publishSubmitButton(client, {
    discoveryPrefix,
    deviceId,
    deviceName,
    manufacturer: "YASNO",
    buttonName: "Submit meter reading now",
  });
}

export function publishKyivvodokanalData(client, { discoveryPrefix, deviceId, deviceName, data }) {
  publishSensorData(client, {
    discoveryPrefix,
    deviceId,
    deviceName,
    manufacturer: "Kyivvodokanal",
    sensors: KYIVVODOKANAL_SENSORS,
    data,
  });
}

export function publishKyivvodokanalSubmitButton(client, { discoveryPrefix, deviceId, deviceName }) {
  return publishSubmitButton(client, {
    discoveryPrefix,
    deviceId,
    deviceName,
    manufacturer: "Kyivvodokanal",
    buttonName: "Submit water readings now",
  });
}
