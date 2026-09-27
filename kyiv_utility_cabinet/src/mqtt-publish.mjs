// Publishes YASNO account data to Home Assistant via MQTT discovery.
// One retained /config message per sensor (sent once, or whenever the set
// of applicable sensors changes) and one retained /state message per poll.
import mqtt from "mqtt";

const SENSORS = [
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
  const device = {
    identifiers: [deviceId],
    name: deviceName,
    manufacturer: "YASNO",
    model: "Personal Cabinet",
  };

  for (const sensor of SENSORS) {
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
