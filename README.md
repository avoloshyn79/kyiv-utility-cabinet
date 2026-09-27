# Kyiv Utility Cabinet

A Home Assistant add-on that logs into Kyiv utility provider personal
cabinets with a real headless Chromium browser, on request, and returns the
resulting session cookie. It does not bypass or defeat any anti-bot
protection — it automates a genuine browser, the same way official mobile
apps log in through an embedded WebView.

Built to be shared by several utility integrations
([`ha-yasno-cabinet`](https://github.com/avoloshyn79/ha-yasno-cabinet),
[`ha-kyivvodokanal-cabinet`](https://github.com/avoloshyn79/ha-kyivvodokanal-cabinet),
[`ha-kte-cabinet`](https://github.com/avoloshyn79/ha-kte-cabinet), and a
future Kyivgaz integration) instead of each one carrying its own fragile,
manual-cookie login flow.

## Installation

Requires Home Assistant OS or HA Supervised.

1. **Налаштування** → **Аддони** → **Магазин аддонів** → ⋮ → **Репозиторії**
2. Add this repository's URL: `https://github.com/avoloshyn79/kyiv-utility-cabinet`
3. Find **Kyiv Utility Cabinet** and install it
4. (Recommended) Set an **API key** in the add-on configuration — a secret
   string that callers must send in the `X-Api-Key` header
5. Start the add-on

See [`kyiv_utility_cabinet/DOCS.md`](kyiv_utility_cabinet/DOCS.md) for the
full API reference.

## How it works

An integration (or any automation) sends `{ phone, password }` to
`POST /fetch/<site>`; the add-on launches headless Chromium, logs in exactly
like a real browser would, and returns `{ cookie }`. Nothing is stored or
scheduled inside the add-on — the caller decides when to ask for a fresh
login.

## Supported sites

| Path | Provider | Status |
|---|---|---|
| `/fetch/yasno` | YASNO (electricity) | Implemented |
| `/fetch/kyivvodokanal` | Kyivvodokanal (water) | Planned |
| `/fetch/kte` | Kyivteploenergo (heating) | Planned |
| `/fetch/kyivgaz` | Kyivgaz (gas) | Planned |

Adding a site is one new module under
[`kyiv_utility_cabinet/src/sites/`](kyiv_utility_cabinet/src/sites/) — see
the existing `yasno.mjs` for the shape every module follows.

## License

MIT
