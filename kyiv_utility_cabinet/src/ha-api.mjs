// Reads entity states from Home Assistant's own Core API, proxied through
// the Supervisor (requires `homeassistant_api: true` in config.yaml, which
// injects SUPERVISOR_TOKEN and allows calling http://supervisor/core/api/*).
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN;

export async function getEntityStateAsNumber(entityId) {
  if (!entityId) {
    throw new Error("No entity_id configured for this meter reading source");
  }

  const response = await fetch(`http://supervisor/core/api/states/${entityId}`, {
    headers: {
      Authorization: `Bearer ${SUPERVISOR_TOKEN}`,
      Accept: "application/json",
    },
  });

  if (response.status === 404) {
    throw new Error(`Entity '${entityId}' not found in Home Assistant`);
  }
  if (!response.ok) {
    throw new Error(`Home Assistant API returned HTTP ${response.status} for entity '${entityId}'`);
  }

  const data = await response.json();
  const value = parseFloat(data.state);
  if (Number.isNaN(value)) {
    throw new Error(`Entity '${entityId}' state '${data.state}' is not a number`);
  }
  return value;
}
