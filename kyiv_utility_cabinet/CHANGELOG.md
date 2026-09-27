# Changelog

## 2.0.0

- Added scheduled polling + MQTT discovery publishing: the add-on now logs
  in, fetches account data, and creates/updates Home Assistant sensors
  itself — no Python integration needed. YASNO is the first service wired
  up end to end (`yasno.enabled` option).
- MQTT broker connection auto-detected via the `mqtt:want` service
  dependency (works out of the box with the Mosquitto add-on), with manual
  override options for an external broker.
- The manual `POST /fetch/<site>` HTTP API from 1.0.0 is unchanged and still
  available for on-demand logins or other automations.

## 1.0.0

- Extracted from the `ha-yasno-cabinet` repository into its own project,
  renamed to **Kyiv Utility Cabinet**, since it's meant to host logins for
  multiple Kyiv utility providers, not just YASNO.
- Stateless HTTP login proxy (`POST /fetch/<site>`): callers pass credentials
  per request and receive the cookie directly, so any integration (or
  automation) can request a fresh login on its own schedule.
