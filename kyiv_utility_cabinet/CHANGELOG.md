# Changelog

## 2.5.0

- Added a `debug` option (off by default). On, it brings back the full
  step-by-step login play-by-play, browser console errors, failed
  sub-requests, and HTTP responses ≥400 - all of that now goes through a
  shared `debugLog()` instead of always printing, so normal operation stays
  quiet. Attempt/retry outcomes and failure snapshots (screenshot/HTML/info
  under `/data/debug/`) are unaffected - they always log, since that's
  exactly the information needed right when something breaks.
- Meter reading submissions (scheduled and manual) now log with an explicit
  `[scheduled]` / `[manual]` tag on every line, and the persisted
  once-per-month record also keeps which one it was and when, not just the
  month - visible in the log when the scheduled check skips a month because
  the button already covered it.
- Hardened the once-per-month guarantee: the scheduled check and the manual
  button share one record, so whichever runs first each month blocks the
  other for the rest of it, and the check re-reads that record fresh from
  disk every hourly tick (picks up a manual submission immediately, and
  survives an add-on restart without risking a second submission the same
  month). Backward-compatible with the plain year-month string the record
  used before this version.

## 2.4.0

- Added a **Submit meter reading now** button (via MQTT discovery, on the
  YASNO Cabinet device) for on-demand meter reading submission - shares the
  exact same logic as the scheduled monthly submission (auto-detected meter
  type, zone labels taken from the account's last reading), just triggered
  immediately instead of waiting for `day_of_month`. Still records the
  month as submitted afterwards, so the scheduled check doesn't also fire
  later that month. Only appears once at least one of `entity_single` /
  `entity_day` / `entity_night` is configured. Concurrent presses (or a
  press landing on top of the scheduled check) are ignored rather than
  starting a second submission in parallel.

## 2.3.0

- Added automatic monthly meter reading submission to YASNO
  (`yasno.submit_readings`): the add-on reads the current value(s) from
  Home Assistant entities you configure (`entity_single`, or `entity_day` +
  `entity_night` for a two-zone meter) via Home Assistant's own Core API -
  requires no separate credentials, just `homeassistant_api: true` on the
  add-on (already set). Ported the actual submission call
  (`POST /api/account-service/users/me/b2c/meter-readings/{account_id}`)
  from the original `ha-yasno-cabinet` integration's
  `send_meter_readings` service.
- Meter type (single-zone vs day/night) is auto-detected from your
  account's last known reading by default, with `meter_type: single` /
  `day_night` to override. The zone labels sent back to YASNO are the
  exact ones it already returned for your account, not a hardcoded guess.
- Runs on its own hourly check independent of `yasno.interval_minutes`, so
  it still reliably catches the configured `day_of_month` even if the data
  refresh interval is set to something long like a week. A successful
  submission is recorded to disk so it isn't repeated again that month,
  including across add-on restarts; a failed one retries every hour until
  it succeeds or the month rolls over.

## 2.2.0

- Detect YASNO's own "невірний телефон або пароль" (invalid phone/password)
  message directly in the page and fail fast with a clear
  `YasnoInvalidCredentialsError`, instead of waiting out the full timeout.
  This case is **not** retried - a wrong password won't fix itself, and
  hammering the login with retries is unhelpful (and unfriendly to the
  account). All other failures (e.g. a transient asset-loading hiccup) are
  still retried up to 3 times as before.
- Rewrote the redirect-waiting logic as a single polling loop (checks the
  URL and the page text every 500ms) instead of racing `waitForURL` against
  a separate heartbeat timer - simpler, and it's what made the error
  detection above possible without a second parallel wait.
- Removed the `yasno.account_id` option: it invited confusion between the
  internal API id and the account number printed on an invoice. The first
  B2C account is now always auto-selected; picking a specific one can come
  back later as a real feature once it's needed.
- Verified end-to-end locally: a correct password logs in and fetches data
  normally; a wrong password is now reported in ~1s instead of 45s, with no
  retry.

## 2.1.0

- Much more detailed logging for the YASNO login flow, all directly in the
  add-on's own log (Supervisor UI) - no shell/curl access needed:
  - A timestamped step for every stage (navigating, waiting for redirect,
    filling phone/password, etc.)
  - A "still waiting..." heartbeat every 8s while blocked on a redirect,
    showing the current URL/title, so a long wait is visible progress
    instead of silence until the final timeout
  - Browser-side console errors/warnings, page errors, failed requests,
    and HTTP responses ≥400 - surfaces network-level issues (blocked
    resources, DNS failures) directly
  - On failure: page HTML length, a scan for known bot-protection markers
    (Incapsula, Distil, Cloudflare challenge, captcha), and the first
    500 characters of the page's visible text
- The existing /data/debug/ screenshot+HTML dump and its HTTP endpoints
  are unchanged and still available for when shell/curl access *is*
  possible.

## 2.0.1

- Fixed `page.waitForURL` timeouts during login: it was waiting for the
  full `load` event by default, which a heavy SPA can miss on slower
  hardware (e.g. Raspberry Pi) even after the redirect itself already
  happened. Now waits only for the URL to commit, with a longer timeout.
- On a failed login, the add-on now saves a screenshot, the page HTML, and
  basic info (URL, title, error) to `/data/debug/`, retrievable via
  `GET /debug/yasno/{screenshot,html,info}` — makes failures diagnosable
  from the logs alone instead of guessing.

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
