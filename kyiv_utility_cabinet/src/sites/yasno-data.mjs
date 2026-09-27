// Fetches YASNO personal-cabinet account data using an already-obtained
// session cookie. Mirrors custom_components/yasno_cabinet/api.py's
// async_get_data() in the ha-yasno-cabinet repo, so the two stay in sync.
const API_BASE = "https://app.yasno.ua";
const USER_AGENT = "HomeAssistant-YASNO/1.0";

export class YasnoAuthError extends Error {}

async function apiGet(path, cookie) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Accept: "application/json, text/plain, */*",
      Origin: "https://yasno.ua",
      Referer: "https://yasno.ua/",
      "User-Agent": USER_AGENT,
      "x-platform": "Web",
      Cookie: cookie,
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new YasnoAuthError(`Authentication failed (HTTP ${response.status}) for ${path}`);
  }
  if (response.status >= 400) {
    const text = await response.text().catch(() => "");
    throw new Error(`YASNO API returned HTTP ${response.status} for ${path}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

function selectAccount(accounts, accountId) {
  if (accountId) {
    const found = accounts.find((a) => String(a.id) === String(accountId));
    if (!found) throw new Error(`Account ID '${accountId}' not found in API data`);
    return found;
  }
  return accounts.find((a) => a.customerType === "B2C") || accounts[0];
}

function safeFloat(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = parseFloat(value.replace(",", "."));
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function extractAccountMapping(obj, accountId) {
  return obj && typeof obj === "object" && !Array.isArray(obj) ? obj[accountId] ?? null : null;
}

function extractLatestConsumption(consumptionInfo) {
  const months = consumptionInfo?.months;
  if (!Array.isArray(months) || months.length === 0) return null;
  const stats = months[months.length - 1]?.stats;
  if (!Array.isArray(stats)) return null;
  let total = 0;
  let found = false;
  for (const stat of stats) {
    const value = safeFloat(stat?.consumedAmount);
    if (value === null) continue;
    total += value;
    found = true;
  }
  return found ? total : null;
}

function extractLastPayment(paymentsData) {
  const items = paymentsData?.items;
  if (!Array.isArray(items) || items.length === 0) return {};
  return { amount: safeFloat(items[0]?.amount), date: items[0]?.createdOn ?? null };
}

function extractLastMeterReadings(readingsData) {
  const items = readingsData?.items;
  if (!Array.isArray(items) || items.length === 0) return {};
  const info = { date: items[0]?.createdOn ?? null };
  for (const reading of items[0]?.meteringReadings ?? []) {
    const zone = (reading?.zone || "").toLowerCase();
    if (zone) info[zone] = safeFloat(reading?.value);
  }
  return info;
}

function extractTariffPrices(tariffData) {
  const prices = {};
  for (const period of tariffData?.priceAtPeriods ?? []) {
    for (const tier of period?.tiers ?? []) {
      for (const t of tier?.tariff ?? []) {
        if (t?.zone && t?.price != null) prices[t.zone.toLowerCase()] = parseFloat(t.price);
      }
    }
  }
  return prices;
}

export async function fetchAccountData(cookie, accountId) {
  const accountsData = await apiGet("/api/account-service/users/me/accounts", cookie);
  if (!Array.isArray(accountsData) || accountsData.length === 0) {
    throw new Error("No accounts found in YASNO profile");
  }

  const account = selectAccount(accountsData, accountId);
  const accId = String(account.id);

  const [debtData, consumptionData, lastFeesData, tariffData, paymentsHistoryData, meterReadingsData] =
    await Promise.all([
      apiGet("/api/account-service/users/me/b2c/debt", cookie),
      apiGet("/api/account-service/statistics/consumptions-by-accounts", cookie),
      apiGet("/api/account-service/users/me/accounts/b2c/last-fees", cookie),
      apiGet(`/api/account-service/users/me/accounts/v3/b2c/${accId}/tariff`, cookie),
      apiGet(`/api/payment-service/payment/history?accountId=${accId}&limit=1&offset=0`, cookie),
      apiGet(
        `/api/account-service/users/me/b2c/meter-readings/history/${accId}?includeRejected=false&limit=1&offset=0`,
        cookie
      ),
    ]);

  const debtInfo = extractAccountMapping(debtData, accId);
  const consumptionInfo = extractAccountMapping(consumptionData, accId);
  const lastFeeRaw = extractAccountMapping(lastFeesData, accId);
  const tariffPrices = extractTariffPrices(tariffData);
  const lastPaymentInfo = extractLastPayment(paymentsHistoryData);
  const meterReadingsInfo = extractLastMeterReadings(meterReadingsData);

  const balanceValue = safeFloat(debtInfo?.balance);
  // KNOWN ISSUE (ported as-is from ha-yasno-cabinet's api.py): this reads
  // the same "balance" key for both balance and debt, so debt always ends
  // up 0. Needs a real debt_info payload sample to find the correct key
  // before fixing on both sides.
  let debtValue = safeFloat(debtInfo?.balance);
  if (debtValue === balanceValue) debtValue = 0.0;

  return {
    balance: balanceValue,
    debt: debtValue,
    consumption_kwh: extractLatestConsumption(consumptionInfo),
    last_payment: lastPaymentInfo.amount ?? null,
    last_payment_date: lastPaymentInfo.date ?? null,
    last_fee_date: typeof lastFeeRaw === "string" ? lastFeeRaw : null,
    account_number: account.accountNumber ?? null,
    account_id: accId,
    account_name: account.accountName ?? null,
    address: account.details?.b2C?.address ?? null,
    region: account.region ?? null,
    supplier: account.supplier ?? null,
    tariff_name: tariffData?.overview?.name ?? null,
    tariff_price_day: tariffPrices.day ?? null,
    tariff_price_night: tariffPrices.night ?? null,
    tariff_price_single: tariffPrices.single ?? null,
    dso_name: tariffData?.distributionSystemOperator?.name ?? null,
    meter_reading_day: meterReadingsInfo.day ?? null,
    meter_reading_night: meterReadingsInfo.night ?? null,
    meter_reading_alltime: meterReadingsInfo.alltime ?? null,
    meter_reading_date: meterReadingsInfo.date ?? null,
  };
}
