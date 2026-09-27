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
| Kyivvodokanal (water) | ✅ | ✅ `/fetch/kyivvodokanal` |
| Kyivteploenergo (heating) | Planned | Planned |
| Kyivgaz (gas) | Planned | Planned |

## Configuration

| Option | Description |
|---|---|
| `debug` | Off by default. Turn on for a detailed play-by-play of the login flow (every step, browser console errors, failed sub-requests, HTTP responses ≥400) - useful when troubleshooting, too noisy to leave on normally. Attempt/retry outcomes and failure snapshots are always logged regardless of this setting. |
| `api_key` | Shared secret required in the `X-Api-Key` header for manual `/fetch/<site>` calls. Leave empty to disable the check (not recommended once this add-on is reachable from more than just Home Assistant itself). |
| `discovery_prefix` | MQTT discovery prefix, must match Home Assistant's MQTT integration setting (default `homeassistant`). |
| `mqtt_host` / `mqtt_port` / `mqtt_username` / `mqtt_password` | Broker connection. Leave blank to use the broker Home Assistant's own MQTT integration is configured with (auto-detected via the add-on's `mqtt:want` service dependency — works out of the box with the Mosquitto broker add-on). |
| `yasno.enabled` | Turn on scheduled polling + MQTT publishing for YASNO. |
| `yasno.phone` / `yasno.password` | YASNO personal cabinet login. |
| `yasno.interval_minutes` | How often to log in and refresh (default 1440 = once a day). |
| `yasno.submit_readings.enabled` | Turn on automatic monthly meter reading submission to YASNO. |
| `yasno.submit_readings.day_of_month` | Day of the month to submit on (default 25). Checked once an hour, so any restart or delay that day still catches it. |
| `yasno.submit_readings.meter_type` | `auto` (default, matches your actual meter from the last reading YASNO already has), `single`, or `day_night` — override only if auto-detection picks the wrong one. |
| `yasno.submit_readings.entity_single` | Home Assistant entity ID holding the current total meter reading (single-zone meters). |
| `yasno.submit_readings.entity_day` / `entity_night` | Home Assistant entity IDs holding the current day/night meter readings (two-zone meters). |
| `kyivvodokanal.enabled` | Turn on scheduled polling + MQTT publishing for Kyivvodokanal. |
| `kyivvodokanal.email` / `kyivvodokanal.password` | Kyivvodokanal personal cabinet login (`my.vodokanal.kiev.ua`). |
| `kyivvodokanal.interval_minutes` | How often to log in and refresh (default 1440 = once a day). |
| `kyivvodokanal.submit_readings.enabled` | Turn on automatic monthly meter reading submission to Kyivvodokanal. |
| `kyivvodokanal.submit_readings.day_of_month` | Day of the month to submit on (default 26). Checked once an hour. |
| `kyivvodokanal.submit_readings.entity_hot` / `entity_cold` | Home Assistant entity IDs holding the current hot/cold water meter readings. Fill in whichever you actually have a counter for - most accounts have cold only, some have both. |

If your YASNO profile has more than one account, the first B2C account is
used automatically (no option to pick a different one yet).

## Automatic meter reading submission

Some YASNO accounts require you to self-report your meter reading each
month. With `yasno.submit_readings.enabled: true`, the add-on reads the
current value(s) directly from Home Assistant entities you point it at
(via Home Assistant's own API — no separate credentials needed) and submits
them to YASNO once, on the configured day of the month.

- **Meter type**: left on `auto`, the add-on looks at the last reading
  YASNO already has on file to tell a two-zone (day/night) meter from a
  single-zone one, the same way the sensors decide which ones to show. Set
  `single` or `day_night` explicitly if you ever need to override that.
- **Entities**: fill in `entity_single` for a single-zone meter, or both
  `entity_day` and `entity_night` for a two-zone one — typically a utility
  meter or template sensor you already have in Home Assistant tracking your
  actual meter's dial/display.
- **Guaranteed once per month, never more**: a successful automatic
  submission is recorded to `/data/`, so it won't repeat again that month
  even across add-on restarts. A failed attempt (e.g. an entity is
  unavailable that hour) isn't recorded, so the scheduled check keeps
  retrying hourly until it succeeds or the month rolls over. This applies
  only to the automatic schedule - see below for the manual button, which
  is unrestricted.
- The zone labels sent to YASNO (`"Day"`/`"Night"`/`"Alltime"`) are taken
  from your account's own last reading when available, so the payload
  matches whatever YASNO itself calls each zone rather than a guess.
- **Logging**: every attempt logs what it's about to submit, whether it
  succeeded or failed, and whether it was triggered by the schedule or the
  manual button (`[scheduled]` / `[manual]` tag on each log line) - always
  on, independent of the `debug` option above.

### Manual submission

If at least one of `entity_single`/`entity_day`/`entity_night` is filled
in, a **Submit meter reading now** button also appears on the YASNO Cabinet
device in Home Assistant. Pressing it submits immediately using the current
entity values, using the same auto-detected meter type as the schedule.

The button is **not** limited to once a month and doesn't interact with the
automatic schedule's once-a-month record at all - press it as many times as
you like (e.g. to double-check a reading, or to correct one you already
sent by hand outside the app), and the automatic submission will still run
on its configured day regardless of any manual presses that month.

## Kyivvodokanal and reCAPTCHA

Kyivvodokanal's login page (`my.vodokanal.kiev.ua/sign-in`) has a Google
reCAPTCHA v2 checkbox. The add-on clicks it once, exactly like a real user
would - it does **not** attempt to solve an image/audio challenge if Google
presents one instead of accepting the click, and it does not patch the
browser to hide that it's automation-controlled.

Whether the plain click is accepted seems to depend on signals outside the
add-on's control - network/IP reputation and browser history - so it may
behave differently on your Home Assistant network than in a normal browser
on your own computer. To help, the add-on uses a **persistent** Chromium
profile under `/data/kyivvodokanal-chrome-profile` instead of a throwaway
one per login, so Google's own cookies accumulate across logins the same
way they would in a real browser you keep reusing, rather than every login
looking like a brand-new device. This is not guaranteed to be enough on its
own - tested locally from a datacenter network, it was still challenged
even on a second login reusing the same profile - but it should only help,
and matters most over real, longer-term use on your actual network. If the
add-on's log shows a "reCAPTCHA presented an additional challenge" error:

- It isn't retried automatically (retrying the same challenge immediately
  won't change the outcome).
- A screenshot/HTML snapshot is saved to `/data/debug/`, same as any other
  login failure - see [Debugging a failed login](#debugging-a-failed-login).
- There's currently no manual-cookie fallback built into this add-on for
  Kyivvodokanal; if automated login doesn't work reliably from your network,
  the separate
  [ha-kyivvodokanal-cabinet](https://github.com/avoloshyn79/ha-kyivvodokanal-cabinet)
  integration (manual cookie paste) remains an option.

### Improving the odds: sign into Google once, for real

A browser profile with an actual signed-in Google session is one of the
strongest positive signals reCAPTCHA looks at - much stronger than cookie
persistence alone. The add-on can't establish that itself (Google's own
sign-in has strong bot defenses of its own; automating a real login into it
risks the account getting flagged, and breaks outright with 2FA), so this
has to be a real, one-time human action:

1. On your own computer (with Google Chrome already installed), from
   inside a checkout of this repo's `kyiv_utility_cabinet/` folder
   (`npm install` already run), run:
   ```
   node tools/setup-kyivvodokanal-profile.mjs
   ```
   This uses your real installed Chrome, not a bundled test build - more
   authentic for signing into Google, and avoids the "this browser may not
   be secure" warning Google shows for unbranded Chromium builds.
2. A real, visible Chromium window opens. Log into your Google account
   normally, then go to `https://my.vodokanal.kiev.ua/sign-in` and log in
   there too (solving the captcha as usual - it's just you, in a real
   browser).
3. Close the window. The script prints the profile folder it saved
   (defaults to somewhere under your OS temp directory).
4. Copy that **whole folder** onto the add-on's persistent storage (e.g.
   via the Samba share or SSH & Web Terminal add-ons) to exactly:
   ```
   /data/kyivvodokanal-chrome-profile
   ```
   replacing whatever the add-on already created there.
5. Restart the add-on - its headless logins now reuse that already
   signed-in profile instead of a cookie-less one.

This is not guaranteed to eliminate the challenge (the add-on's browser is
still CDP-automated, which is its own signal), but it removes one of the
biggest gaps between it and a real browser session.

Everything else about Kyivvodokanal - scheduled polling, MQTT sensors,
meter reading submission, the manual button, `debug` logging - works the
same way as YASNO, described above and below.

### Kyivvodokanal meter reading submission

Same mechanics as YASNO's (guaranteed once a month via the schedule, the
manual button is unrestricted and doesn't interact with that guarantee,
every attempt is logged with a `[scheduled]`/`[manual]` tag), with one
difference: instead of a single/day-night tariff split, readings are
per-counter. Fill in `entity_hot` and/or `entity_cold` depending on which
water meters you actually have; the add-on matches each to the
corresponding counter ID it already discovered from your account (there's
no need to look up or configure counter IDs yourself). If you fill in
`entity_hot` but your account has no hot water counter, the submission
fails with a clear error rather than guessing.

## What gets created in Home Assistant

With `yasno.enabled: true`, a **YASNO Cabinet** device appears automatically
(via MQTT discovery) with sensors for balance, debt, consumption, tariffs,
meter readings, last payment, and account number — no manual entity setup.

With `kyivvodokanal.enabled: true`, a **Kyivvodokanal Cabinet** device
appears the same way, with sensors for debt, amount to pay, tariffs
(cold water/sewerage/subscription fee), hot/cold water meter numbers,
check dates, last readings, and last submitted dates.

## Manual HTTP API

### `POST /fetch/yasno`

Headers: `X-Api-Key: <api_key>` (if configured), `Content-Type: application/json`

Body:
```json
{ "phone": "+380XXXXXXXXX", "password": "..." }
```

Response (200): `{ "cookie": "visid_incap_...; other=..." }`
Response (502) on login failure: `{ "error": "..." }`

### `POST /fetch/kyivvodokanal`

Headers: `X-Api-Key: <api_key>` (if configured), `Content-Type: application/json`

Body:
```json
{ "email": "you@example.com", "password": "..." }
```

Response (200): `{ "cookie": "JSESSIONID=...; XSRF-TOKEN=...; ..." }`
Response (502): `{ "error": "..." }` - includes the reCAPTCHA challenge error
described in [Kyivvodokanal and reCAPTCHA](#kyivvodokanal-and-recaptcha) if
that's what happened.

### `GET /health`

Returns `{ "ok": true, "sites": ["yasno", "kyivvodokanal"] }` — use this to
confirm the add-on is reachable before troubleshooting further:
```
curl http://kyiv_utility_cabinet:8099/health
```

### Debugging a failed login

If a login fails (timeout, unexpected page, reCAPTCHA challenge), the
add-on saves what it was looking at to `/data/debug/` and the log message
points you to these endpoints (same `X-Api-Key` as above if configured;
replace `yasno` with `kyivvodokanal` for that site):

| Endpoint | Contents |
|---|---|
| `GET /debug/yasno/screenshot` | Full-page PNG of the browser at the moment it failed |
| `GET /debug/yasno/html` | The page's HTML at that moment |
| `GET /debug/yasno/info` | Plain text: timestamp, URL, page title, error message |
| `GET /debug/kyivvodokanal/screenshot` | Same, for the Kyivvodokanal login |
| `GET /debug/kyivvodokanal/html` | Same, for the Kyivvodokanal login |
| `GET /debug/kyivvodokanal/info` | Same, for the Kyivvodokanal login |

## Notes

- Each login takes a few seconds and a temporary memory/CPU spike (real
  Chromium), especially on Raspberry Pi (aarch64) — this is why polling is
  scheduled in hours, not minutes.
- A login is retried automatically up to 3 times on a transient failure
  (e.g. the login page's JS bundle failing to load, which happens
  occasionally even in a real browser). If YASNO itself rejects the phone
  number or password, or Kyivvodokanal's reCAPTCHA challenges the attempt,
  the add-on log says so directly and does **not** retry - retrying either
  of those immediately won't change the outcome.
- If a site changes its login page's structure, that site's module may need
  updating — check the add-on log for the failure point.
- The `debt` sensor currently always reads 0 — a known upstream issue (it
  reads the same API field as `balance`); needs a real `debt` API payload
  sample to find the correct field.
