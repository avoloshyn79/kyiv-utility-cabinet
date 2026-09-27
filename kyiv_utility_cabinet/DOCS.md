# Kyiv Utility Cabinet

An HTTP login proxy that logs into Kyiv utility provider personal cabinets
using a real headless Chromium browser (via Playwright), on request. It does
not store any credentials itself and does not bypass or defeat any anti-bot
protection — it automates a genuine browser, the same way official mobile
apps log in through an embedded WebView.

Callers (Home Assistant integrations, or your own automations) send
credentials on every request; the proxy logs in and returns the resulting
session cookie. Nothing is cached or scheduled inside the add-on — the
caller decides when to refresh.

## Supported sites

| Path | Site |
|---|---|
| `/fetch/yasno` | YASNO personal cabinet (yasno.ua) — electricity |

More sites (Kyivvodokanal, Kyivteploenergo, Kyivgaz) can be added as
additional modules under `src/sites/`, matching the existing
`ha-kyivvodokanal-cabinet` and `ha-kte-cabinet` integrations.

## Configuration

| Option | Description |
|---|---|
| `api_key` | Shared secret required in the `X-Api-Key` header on every request. Leave empty to disable the check (not recommended once this add-on is reachable from more than just Home Assistant itself). |

## API

### `POST /fetch/yasno`

Headers: `X-Api-Key: <api_key>` (if configured), `Content-Type: application/json`

Body:
```json
{ "phone": "+380XXXXXXXXX", "password": "..." }
```

Response (200):
```json
{ "cookie": "visid_incap_...; other=..." }
```

Response (502) on login failure:
```json
{ "error": "..." }
```

### `GET /health`

Returns `{ "ok": true, "sites": ["yasno"] }` — use this to confirm the add-on
is reachable from Home Assistant before troubleshooting further.

## Reaching this add-on from an integration

Home Assistant Core and other add-ons can reach this add-on on the internal
Supervisor network at `http://kyiv_utility_cabinet:8099`. If that hostname
does not resolve in your setup, use the host's IP address and the mapped
port instead.

## Notes

- Each login takes a few seconds and a temporary memory/CPU spike (real
  Chromium), especially on Raspberry Pi (aarch64).
- If a site changes its login page's structure, that site's module may need
  updating — check the add-on log for the failure point.
