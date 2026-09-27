# Changelog

## 1.0.0

- Extracted from the `ha-yasno-cabinet` repository into its own project,
  renamed to **Kyiv Utility Cabinet**, since it's meant to host logins for
  multiple Kyiv utility providers, not just YASNO.
- Stateless HTTP login proxy (`POST /fetch/<site>`): callers pass credentials
  per request and receive the cookie directly, so any integration (or
  automation) can request a fresh login on its own schedule.
