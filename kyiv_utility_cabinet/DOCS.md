# Kyiv Utility Cabinet

Logs into Kyiv utility provider personal cabinets using a real headless
Chromium browser (via Playwright) and publishes the data to Home Assistant
over MQTT — no `custom_components` Python integration required. It does not
bypass or defeat any anti-bot protection — it automates a genuine browser,
the same way official mobile apps log in through an embedded WebView.

Each enabled service runs its own polling loop inside the add-on: log in,
fetch account data, publish it as MQTT-discovered sensors. A manual HTTP API
(`POST /fetch/<site>`) is also available for on-demand logins or your own
automations.

## Supported sites

| Site | Scheduled MQTT polling | Manual `/fetch/<site>` |
|---|---|---|
| YASNO (electricity) | ✅ | ✅ `/fetch/yasno` |
| Kyivvodokanal (water) | Planned | Planned |
| Kyivteploenergo (heating) | Planned | Planned |
| Kyivgaz (gas) | Planned | Planned |

## Configuration

| Option | Description |
|---|---|
| `api_key` | Shared secret required in the `X-Api-Key` header for manual `/fetch/<site>` calls. Leave empty to disable the check (not recommended once this add-on is reachable from more than just Home Assistant itself). |
| `discovery_prefix` | MQTT discovery prefix, must match Home Assistant's MQTT integration setting (default `homeassistant`). |
| `mqtt_host` / `mqtt_port` / `mqtt_username` / `mqtt_password` | Broker connection. Leave blank to use the broker Home Assistant's own MQTT integration is configured with (auto-detected via the add-on's `mqtt:want` service dependency — works out of the box with the Mosquitto broker add-on). |
| `yasno.enabled` | Turn on scheduled polling + MQTT publishing for YASNO. |
| `yasno.phone` / `yasno.password` | YASNO personal cabinet login. |
| `yasno.interval_minutes` | How often to log in and refresh (default 1440 = once a day). |

If your YASNO profile has more than one account, the first B2C account is
used automatically (no option to pick a different one yet).

## What gets created in Home Assistant

With `yasno.enabled: true`, a **YASNO Cabinet** device appears automatically
(via MQTT discovery) with sensors for balance, debt, consumption, tariffs,
meter readings, last payment, and account number — no manual entity setup.

## Manual HTTP API

### `POST /fetch/yasno`

Headers: `X-Api-Key: <api_key>` (if configured), `Content-Type: application/json`

Body:
```json
{ "phone": "+380XXXXXXXXX", "password": "..." }
```

Response (200): `{ "cookie": "visid_incap_...; other=..." }`
Response (502) on login failure: `{ "error": "..." }`

### `GET /health`

Returns `{ "ok": true, "sites": ["yasno"] }` — use this to confirm the add-on
is reachable before troubleshooting further:
```
curl http://kyiv_utility_cabinet:8099/health
```

### Debugging a failed login

If a login fails (timeout, unexpected page), the add-on saves what it was
looking at to `/data/debug/` and the log message points you to these
endpoints (same `X-Api-Key` as above if configured):

| Endpoint | Contents |
|---|---|
| `GET /debug/yasno/screenshot` | Full-page PNG of the browser at the moment it failed |
| `GET /debug/yasno/html` | The page's HTML at that moment |
| `GET /debug/yasno/info` | Plain text: timestamp, URL, page title, error message |

## Notes

- Each login takes a few seconds and a temporary memory/CPU spike (real
  Chromium), especially on Raspberry Pi (aarch64) — this is why polling is
  scheduled in hours, not minutes.
- A login is retried automatically up to 3 times on a transient failure
  (e.g. the login page's JS bundle failing to load, which happens
  occasionally even in a real browser). If YASNO itself rejects the phone
  number or password, the add-on log says so directly and does **not**
  retry - fix the credentials in the add-on configuration instead.
- If a site changes its login page's structure, that site's module may need
  updating — check the add-on log for the failure point.
- The `debt` sensor currently always reads 0 — a known upstream issue (it
  reads the same API field as `balance`); needs a real `debt` API payload
  sample to find the correct field.
