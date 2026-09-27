// Fetches Kyivvodokanal personal-cabinet account data using an already-
// obtained session cookie. Mirrors custom_components/kyivvodokanal_cabinet's
// api.py + coordinator.py in the ha-kyivvodokanal-cabinet repo, so the two
// stay in sync.
const API_BASE = "https://my.vodokanal.kiev.ua";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const DEFAULT_SERVICE_PROVIDER_CODE = "999";
const COUNTER_TYPE_HOT_KEYWORDS = ["гаряч", "hot"];
const COUNTER_TYPE_COLD_KEYWORDS = ["холод", "cold"];

export class KyivvodokanalAuthError extends Error {}

function getCookieValue(cookie, name) {
  for (const item of cookie.split(";")) {
    const idx = item.indexOf("=");
    if (idx === -1) continue;
    if (item.slice(0, idx).trim() === name) return item.slice(idx + 1).trim();
  }
  return null;
}

function defaultHeaders(cookie) {
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    "Accept-Language": "uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7",
    Referer: API_BASE,
    Origin: API_BASE,
    Cookie: cookie,
  };
  const xsrfToken = getCookieValue(cookie, "XSRF-TOKEN");
  if (xsrfToken) headers["X-XSRF-TOKEN"] = xsrfToken;
  return headers;
}

async function apiGet(path, cookie) {
  const response = await fetch(`${API_BASE}${path}`, { headers: defaultHeaders(cookie) });
  if (response.status === 401 || response.status === 403) {
    throw new KyivvodokanalAuthError(`Authentication failed (HTTP ${response.status}) for ${path}`);
  }
  if (response.status >= 400) {
    const text = await response.text().catch(() => "");
    throw new Error(`Kyivvodokanal API returned HTTP ${response.status} for ${path}: ${text.slice(0, 200)}`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    if (text.toLowerCase().includes("<html") || text.toLowerCase().includes("login")) {
      throw new KyivvodokanalAuthError("Authentication failed or invalid session cookie");
    }
    throw new Error(`Invalid JSON response from ${path}`);
  }
}

async function apiPost(path, cookie, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: defaultHeaders(cookie),
    body: JSON.stringify(body),
  });
  if (response.status === 401 || response.status === 403) {
    throw new KyivvodokanalAuthError(`Authentication failed (HTTP ${response.status}) for ${path}`);
  }
  if (response.status >= 400) {
    const text = await response.text().catch(() => "");
    throw new Error(`Kyivvodokanal API returned HTTP ${response.status} for ${path}: ${text.slice(0, 200)}`);
  }
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response from ${path}`);
  }
}

async function getPaymentsHistory(cookie, startDate, endDate) {
  return apiPost("/api/warehouse/consumer/payments/history", cookie, {
    serviceProviderGroupIds: [22],
    financePointId: "",
    from: startDate,
    to: endDate,
  });
}

async function getAmountToPay(cookie, serviceProviderCode, invoiceAccountCode) {
  return apiGet(
    `/api/warehouse/consumer/invoice/amount_to_pay?serviceProviderCode=${serviceProviderCode}&code=${invoiceAccountCode}`,
    cookie
  );
}

async function getCounters(cookie, serviceProviderCode, invoiceAccountCode) {
  return apiGet(
    `/api/warehouse/consumer/counters?serviceProviderCode=${serviceProviderCode}&invoiceAccountCode=${invoiceAccountCode}`,
    cookie
  );
}

async function getCounterFactorsHistory(cookie, invoiceAccountCode, serviceProviderCode, startDate, endDate) {
  return apiPost("/api/warehouse/consumer/counter/factors/history", cookie, {
    invoiceAccountCode,
    serviceProviderCode,
    range: { from: startDate, to: endDate },
  });
}

async function getTariffs(cookie, serviceProviderCode, invoiceAccountCode) {
  let result = await apiGet(
    `/api/warehouse/consumer/tariff?serviceProviderCode=${serviceProviderCode}&invoiceAccountCode=${invoiceAccountCode}`,
    cookie
  );
  // The API sometimes wraps the real payload as { text: "<json string>" }.
  if (result && typeof result === "object" && !Array.isArray(result) && "text" in result) {
    result = typeof result.text === "string" ? JSON.parse(result.text) : result.text;
  }
  return result;
}

async function getLastFactors(cookie, counterId) {
  return apiGet(`/api/warehouse/consumer/counter/${counterId}/last-factors`, cookie);
}

/**
 * Submits meter readings, e.g. [{ counterId: 123, factor: 45.6 }].
 */
export async function submitReadings(cookie, readings) {
  return apiPost("/api/warehouse/consumer/counter/factor", cookie, readings);
}

function extractServiceProviderAndInvoiceCode(payments) {
  for (const item of payments ?? []) {
    const serviceProviderCode = item?.serviceProvider?.code;
    const invoiceAccountCode = item?.invoiceAccount?.code;
    if (serviceProviderCode && invoiceAccountCode) {
      return { serviceProviderCode, invoiceAccountCode };
    }
  }
  return { serviceProviderCode: null, invoiceAccountCode: null };
}

function toDateOnly(isoLike) {
  const d = new Date(isoLike);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parseLastPaymentDate(payments) {
  let last = null;
  for (const item of payments ?? []) {
    const dateStr = item?.payment?.date;
    if (!dateStr) continue;
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) continue;
    if (!last || d > last) last = d;
  }
  return last ? last.toISOString().slice(0, 10) : null;
}

function getServiceProviderName(payments) {
  for (const item of payments ?? []) {
    const name = item?.serviceProvider?.name;
    if (name) return name;
  }
  return null;
}

function parseTariffs(tariffs) {
  const summary = { tariff_cold_water: null, tariff_sewerage: null, tariff_abone: null };
  for (const tariff of tariffs ?? []) {
    const tariffAmount = tariff?.tariffAmount;
    if (tariffAmount == null) continue;

    const serviceTypeName = (tariff?.serviceType?.name || "").toLowerCase();
    const serviceCode = tariff?.service?.code || "";
    const serviceName = (tariff?.service?.name || "").toLowerCase();
    const subServiceName = (tariff?.subService?.name || "").toLowerCase();

    if (serviceTypeName.includes("абон") || serviceCode === "35" || serviceName.includes("абонентське")) {
      summary.tariff_abone = tariffAmount;
    } else if (subServiceName.includes("водовідведення") || subServiceName.includes("каналіз")) {
      summary.tariff_sewerage = tariffAmount;
    } else if (subServiceName.includes("водопостачання") && subServiceName.includes("хв")) {
      summary.tariff_cold_water = tariffAmount;
    }
  }
  return summary;
}

function counterPrefix(counter) {
  const typeName = (counter?.counterType?.name || "").toLowerCase();
  if (COUNTER_TYPE_HOT_KEYWORDS.some((k) => typeName.includes(k))) return "hot_water";
  if (COUNTER_TYPE_COLD_KEYWORDS.some((k) => typeName.includes(k))) return "cold_water";
  return null;
}

function parseCountersSummary(counters) {
  const summary = {
    hot_water_counter_number: null,
    hot_water_counter_check_date: null,
    hot_water_counter_next_check_date: null,
    cold_water_counter_number: null,
    cold_water_counter_check_date: null,
    cold_water_counter_next_check_date: null,
  };
  const counterTypeById = {};
  const counterIdByType = {};

  for (const counter of counters ?? []) {
    const counterId = counter?.id;
    const prefix = counterPrefix(counter);
    if (!prefix || counterId == null) continue;

    summary[`${prefix}_counter_number`] = counter?.number ?? null;
    summary[`${prefix}_counter_check_date`] = counter?.checkDate ? toDateOnly(counter.checkDate) : null;
    summary[`${prefix}_counter_next_check_date`] = counter?.nextCheckDate ? toDateOnly(counter.nextCheckDate) : null;
    counterTypeById[counterId] = prefix;
    counterIdByType[prefix] = counterId;
  }

  return { summary, counterTypeById, counterIdByType };
}

function parseCounterFactorsSummary(factors, counterTypeById) {
  const summary = { hot_water_last_reading: null, cold_water_last_reading: null };
  const lastPeriods = {};

  for (const factor of factors ?? []) {
    const prefix = counterTypeById[factor?.counterId];
    if (!prefix) continue;
    const periodStr = factor?.invoicePeriod;
    if (!periodStr) continue;
    const period = new Date(periodStr);
    if (Number.isNaN(period.getTime())) continue;
    const endFactor = factor?.endFactor;
    if (endFactor == null) continue;

    if (!lastPeriods[prefix] || period > lastPeriods[prefix]) {
      summary[`${prefix}_last_reading`] = endFactor;
      lastPeriods[prefix] = period;
    }
  }
  return summary;
}

function parseLastFactorsDates(lastFactors, counterTypeById) {
  const summary = {
    hot_water_last_transmission_date: null,
    cold_water_last_transmission_date: null,
    last_transmission_date: null,
  };

  for (const factor of lastFactors ?? []) {
    const prefix = counterTypeById[factor?.id];
    if (!prefix) continue;
    const dateFromStr = factor?.dateFrom;
    if (!dateFromStr) continue;
    const parsed = toDateOnly(dateFromStr);
    if (parsed) summary[`${prefix}_last_transmission_date`] = parsed;
  }

  const dates = [summary.hot_water_last_transmission_date, summary.cold_water_last_transmission_date].filter(
    Boolean
  );
  if (dates.length > 0) {
    summary.last_transmission_date = dates.reduce((a, b) => (a > b ? a : b));
  }
  return summary;
}

export async function fetchAccountData(cookie) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0));
  const startIso = start.toISOString();
  const endIso = now.toISOString();

  const payments = await getPaymentsHistory(cookie, startIso, endIso);
  const { serviceProviderCode, invoiceAccountCode } = extractServiceProviderAndInvoiceCode(payments);

  let invoiceAmount = {};
  let counters = [];
  let factors = [];
  let tariffs = [];
  let lastFactors = [];
  let counterTypeById = {};
  let counterIdByType = {};
  let countersSummary = {};

  if (invoiceAccountCode) {
    const spCode = serviceProviderCode || DEFAULT_SERVICE_PROVIDER_CODE;
    invoiceAmount = await getAmountToPay(cookie, spCode, invoiceAccountCode);
    counters = await getCounters(cookie, spCode, invoiceAccountCode);
    factors = await getCounterFactorsHistory(cookie, invoiceAccountCode, spCode, startIso, endIso);
    tariffs = await getTariffs(cookie, spCode, invoiceAccountCode);

    const parsedCounters = parseCountersSummary(counters);
    countersSummary = parsedCounters.summary;
    counterTypeById = parsedCounters.counterTypeById;
    counterIdByType = parsedCounters.counterIdByType;

    for (const counter of counters ?? []) {
      const counterId = counter?.id;
      if (counterId == null) continue;
      try {
        lastFactors.push(await getLastFactors(cookie, String(counterId)));
      } catch {
        // Matches the Python coordinator: log-and-continue, one counter's
        // failure shouldn't take down the whole update.
      }
    }
  }

  return {
    debt: invoiceAmount?.debt ?? null,
    amount_to_pay: invoiceAmount?.amountToPay ?? null,
    last_payment_date: parseLastPaymentDate(payments),
    service_provider_name: getServiceProviderName(payments),
    ...parseTariffs(tariffs),
    ...countersSummary,
    ...parseCounterFactorsSummary(factors, counterTypeById),
    ...parseLastFactorsDates(lastFactors, counterTypeById),
    invoice_account_code: invoiceAccountCode,
    service_provider_code: serviceProviderCode || DEFAULT_SERVICE_PROVIDER_CODE,
    counter_id_by_type: counterIdByType,
  };
}
