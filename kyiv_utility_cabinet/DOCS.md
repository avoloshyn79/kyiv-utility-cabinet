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

Kyivvodokanal is the exception: it is not logged into by the add-on at all
(its sign-in is behind reCAPTCHA). You provide an access token from your own
browser session and the add-on uses it to fetch the data - see
[Kyivvodokanal access token](#kyivvodokanal-access-token).

## Supported sites

| Site | Scheduled MQTT polling | Manual `/fetch/<site>` |
|---|---|---|
| YASNO (electricity) | ✅ | ✅ `/fetch/yasno` |
| Kyivvodokanal (water) | ✅ (with a token you provide) | `GET /data/kyivvodokanal` |
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
| `kyivvodokanal.token` | Access token from `my.vodokanal.kiev.ua` (valid 7 days) - see [Kyivvodokanal access token](#kyivvodokanal-access-token). Optional if you post it to `/token/kyivvodokanal` instead. |
| `kyivvodokanal.interval_minutes` | How often to refresh data (default 1440 = once a day). |
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

## Kyivvodokanal access token

The add-on does **not** log into Kyivvodokanal itself: the sign-in form at
`my.vodokanal.kiev.ua/sign-in` is behind a Google reCAPTCHA, and the site
has no way to refresh a session. Instead you sign in yourself, in your own
browser, and give the add-on the resulting access token. The site's API is
authenticated with that token (`Authorization: Bearer <token>`); its cookies
are only analytics and are not needed.

The token is valid for **7 days** from sign-in, after which you repeat the
steps below. The **Access token expires** sensor on the Kyivvodokanal
Cabinet device shows when - handy for a reminder automation.

### Step 1: copy the token from your browser

Use a desktop browser (Chrome, Edge, Brave, Firefox). Mobile browsers have
no DevTools.

1. Open https://my.vodokanal.kiev.ua/sign-in and sign in as usual (email,
   password, reCAPTCHA). Wait until your cabinet dashboard opens.
2. Press **F12** (or **Ctrl+Shift+I**, **Cmd+Option+I** on macOS) to open
   DevTools.
3. Copy the token - either way works:

   **Console (quickest).** Open the **Console** tab, type this and press
   Enter - the token is now on your clipboard (the console prints
   `undefined`, that's expected):
   ```js
   copy(localStorage.access_token)
   ```

   **Storage panel.**
   - Chrome / Edge / Brave: **Application** tab -> **Storage** ->
     **Local storage** -> `https://my.vodokanal.kiev.ua`.
   - Firefox: **Storage** tab -> **Local Storage** ->
     `https://my.vodokanal.kiev.ua`.

   Click the `access_token` row and copy its value.
4. Check what you copied: a single line of about 200 characters, starting
   with `eyJ`, with two dots in it. Not the `_ga` cookie, not
   `user_profile`.

Don't click **Вийти** (sign out) on the site afterwards. That removes the
token from your browser and may invalidate it on the server too. Just close
the tab.

The token is as good as your password for 7 days. Don't paste it into
chats, issues or screenshots.

### Step 2: give the token to the add-on

Pick one of these.

**A. Add-on configuration (simplest).** Paste the token into
`kyivvodokanal.token` (the field is masked like a password), save, and
restart the add-on. Make sure `kyivvodokanal.enabled` is on.

**B. HTTP API (no restart).** The token is stored under `/data/`
(`kyivvodokanal-token.json`, survives restarts and updates) and the sensors
refresh immediately:
```
curl -X POST http://<home-assistant-ip>:8099/token/kyivvodokanal \
  -H "X-Api-Key: <api_key>" \
  -H "Content-Type: application/json" \
  -d '{"token": "eyJ..."}'
```
The response shows when the token expires:
`{"configured":true,"expires_at":"...","hours_left":167.9}`.

**C. From the Home Assistant UI.** Set up B once as a script, then paste
new tokens from a dashboard or your phone without touching the add-on
config. Add to `configuration.yaml` (and `kyiv_utility_cabinet_api_key:
<your api_key>` to `secrets.yaml`):
```yaml
input_text:
  kyivvodokanal_token:
    name: Kyivvodokanal token
    max: 255
    mode: password

rest_command:
  kyivvodokanal_set_token:
    url: "http://127.0.0.1:8099/token/kyivvodokanal"
    method: POST
    headers:
      X-Api-Key: !secret kyiv_utility_cabinet_api_key
    content_type: "application/json"
    payload: '{"token": "{{ token }}"}'

script:
  kyivvodokanal_apply_token:
    alias: Apply Kyivvodokanal token
    sequence:
      - action: rest_command.kyivvodokanal_set_token
        data:
          token: "{{ states('input_text.kyivvodokanal_token') }}"
      # Don't keep the token sitting in the entity's state.
      - action: input_text.set_value
        target:
          entity_id: input_text.kyivvodokanal_token
        data:
          value: ""

recorder:
  exclude:
    entities:
      - input_text.kyivvodokanal_token
```
Restart Home Assistant. Then paste the token into **Kyivvodokanal token**
and run **Apply Kyivvodokanal token**. `127.0.0.1:8099` works because Home
Assistant runs on the host network and the add-on publishes port 8099
there. If you changed that port in the add-on's **Network** settings, use
yours. `input_text` holds at most 255 characters. Current tokens are
about 200. If a token is ever longer, use A or B.

If both A and a stored token (B/C) are present, the one that expires later
is used. A `Bearer ` prefix or surrounding quotes left over from copying are
stripped automatically.

### Step 3: check it worked

- The add-on log shows
  `[kyivvodokanal] Published. Debt=... AmountToPay=... TokenExpires=...`.
- The **Kyivvodokanal Cabinet** device (**Settings** -> **Devices &
  services** -> **MQTT**) has values in its sensors, and **Access token
  expires** shows the date about 7 days after you signed in.
- Or ask the add-on directly:
  `curl -H "X-Api-Key: <api_key>" http://<home-assistant-ip>:8099/token/kyivvodokanal`.

### Renewing every 7 days

There is no way to extend a token. When it expires, repeat steps 1-2. A
reminder 12 hours ahead (check the sensor's actual entity ID under the
device - it's usually `sensor.access_token_expires`):
```yaml
automation:
  - alias: Kyivvodokanal token expiring
    triggers:
      - trigger: time
        at:
          entity_id: sensor.access_token_expires
          offset: "-12:00:00"
    actions:
      - action: persistent_notification.create
        data:
          title: Kyivvodokanal
          message: >-
            The access token expires
            {{ as_local(as_datetime(states('sensor.access_token_expires'))).strftime('%d.%m %H:%M') }}.
            Sign in at my.vodokanal.kiev.ua and paste a new token.
```
Swap `persistent_notification.create` for `notify.mobile_app_<phone>` to
get it on your phone.

Each sign-in on the site issues a new token. If you sign in again later
(on any device) and the add-on starts logging `token rejected`, the site
invalidated the older token - just give the add-on the newest one.

### Troubleshooting

| Log message | Meaning / fix |
|---|---|
| `No access token configured` | Neither the option nor a stored token is set - do step 2. |
| `Access token expired at ...` | 7 days have passed - get a new token (step 1). |
| `Authentication failed (HTTP 401) ... - token rejected` | The site no longer accepts it (you signed out, changed your password, or copied the wrong value). Get a new token. |
| `Ignoring kyivvodokanal.token option: Not a JWT` | The option holds something other than the token - re-copy it, check step 1.4. |
| `POST /token/kyivvodokanal` -> 400 `Token already expired` | You pasted an old token. |
| `POST /token/kyivvodokanal` -> 401 | `X-Api-Key` doesn't match the add-on's `api_key`. |

When the token is missing, expired or rejected, polling and meter reading
submission log the message above and wait for a new token. The add-on
never retries or tries to log in.

Everything else about Kyivvodokanal - scheduled polling, MQTT sensors,
meter reading submission, the manual button - works the same way as YASNO,
described above and below.

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
check dates, last readings, last submitted dates, and when the access
token expires.

## Manual HTTP API

### `POST /fetch/yasno`

Headers: `X-Api-Key: <api_key>` (if configured), `Content-Type: application/json`

Body:
```json
{ "phone": "+380XXXXXXXXX", "password": "..." }
```

Response (200): `{ "cookie": "visid_incap_...; other=..." }`
Response (502) on login failure: `{ "error": "..." }`

### `POST /token/kyivvodokanal`

Stores a new Kyivvodokanal access token and refreshes the sensors right
away - see [Kyivvodokanal access token](#kyivvodokanal-access-token).

Headers: `X-Api-Key: <api_key>` (if configured), `Content-Type: application/json`

Body: `{ "token": "eyJ..." }`

Response (200): `{ "configured": true, "expires_at": "2026-11-05T13:32:43.000Z", "hours_left": 167.9 }`
Response (400): `{ "error": "..." }` - not a JWT, or already expired.

### `GET /token/kyivvodokanal`

Same response shape as above for the token currently in use - never returns
the token itself.

### `GET /data/kyivvodokanal`

Fetches the account data live with the stored token and returns it as JSON
(the same fields the MQTT sensors are built from, plus `token_expires_at`).
Response (502): `{ "error": "..." }` - e.g. no token, or the token expired
or was rejected.

### `GET /health`

Returns `{ "ok": true, "sites": ["yasno", "kyivvodokanal"] }` — use this to
confirm the add-on is reachable before troubleshooting further:
```
curl http://kyiv_utility_cabinet:8099/health
```

### Debugging a failed login

If a YASNO login fails (timeout, unexpected page), the
add-on saves what it was looking at to `/data/debug/` and the log message
points you to these endpoints (same `X-Api-Key` as above if configured):

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
  retry - retrying that immediately won't change the outcome.
- If a site changes its login page's structure, that site's module may need
  updating — check the add-on log for the failure point.
- The `debt` sensor currently always reads 0 — a known upstream issue (it
  reads the same API field as `balance`); needs a real `debt` API payload
  sample to find the correct field.
