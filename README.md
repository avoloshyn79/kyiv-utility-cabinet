# Kyiv Utility Cabinet

A Home Assistant add-on that logs into Kyiv utility provider personal
cabinets with a real headless Chromium browser and publishes the data to
Home Assistant over MQTT — no Python integration required. It does not
bypass or defeat any anti-bot protection — it automates a genuine browser,
the same way official mobile apps log in through an embedded WebView.

Meant to eventually cover all four Kyiv utilities from one add-on: YASNO
(electricity), Kyivvodokanal (water), Kyivteploenergo (heating), and Kyivgaz
(gas) — replacing what would otherwise be four separate integrations each
carrying its own fragile, manual-cookie login flow.

## Installation

Requires Home Assistant OS or HA Supervised, and an MQTT broker configured
in Home Assistant (e.g. the official Mosquitto broker add-on).

1. **Налаштування** → **Аддони** → **Магазин аддонів** → ⋮ → **Репозиторії**
2. Add this repository's URL: `https://github.com/avoloshyn79/kyiv-utility-cabinet`
3. Find **Kyiv Utility Cabinet** and install it
4. In the add-on's configuration:
   - Set an **API key** (recommended) — a secret string required for manual
     `/fetch/<site>` calls
   - Turn on `yasno.enabled` and fill in your YASNO phone number and password
5. Start the add-on

A **YASNO Cabinet** device with its sensors appears in Home Assistant
automatically, no further setup needed. See
[`kyiv_utility_cabinet/DOCS.md`](kyiv_utility_cabinet/DOCS.md) for the full
configuration and API reference.

## How it works

For each enabled service, the add-on runs its own loop: log in with a real
headless Chromium, fetch account data with the resulting session cookie, and
publish it to Home Assistant via MQTT discovery — creating and updating
sensors automatically. A manual HTTP API (`POST /fetch/<site>`) is also
available for on-demand logins from your own automations.

## Supported sites

| Site | Scheduled MQTT polling | Manual `/fetch/<site>` |
|---|---|---|
| YASNO (electricity) | ✅ | ✅ |
| Kyivvodokanal (water) | Planned | Planned |
| Kyivteploenergo (heating) | Planned | Planned |
| Kyivgaz (gas) | Planned | Planned |

Adding a site is two new modules under
[`kyiv_utility_cabinet/src/sites/`](kyiv_utility_cabinet/src/sites/) (login +
data-fetch) plus one block in
[`scheduler.mjs`](kyiv_utility_cabinet/src/scheduler.mjs) — see the existing
`yasno.mjs` / `yasno-data.mjs` pair for the shape every service follows.

## License

MIT
