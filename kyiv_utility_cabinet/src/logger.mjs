// Shared logging: `log` always prints, `debugLog` only when the add-on's
// `debug` option is on. Verbose step-by-step / heartbeat / page-diagnostic
// output goes through debugLog so normal operation stays quiet by default,
// while the toggle brings it all back for troubleshooting without a code
// change or shell access to the add-on.
let debugEnabled = false;

export function setDebugEnabled(value) {
  debugEnabled = Boolean(value);
}

export function log(component, message) {
  console.log(`[${new Date().toISOString()}] [${component}] ${message}`);
}

export function debugLog(component, message) {
  if (!debugEnabled) return;
  console.log(`[${new Date().toISOString()}] [${component}] [debug] ${message}`);
}
