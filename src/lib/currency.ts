export type Currency = "NOK" | "EUR";
export const CURRENCY_COOKIE = "fleet_currency";

export function formatAmount(amount: number, currency: Currency = "NOK"): string {
  return new Intl.NumberFormat(currency === "NOK" ? "nb-NO" : "de-DE", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatAmountDetailed(amount: number, currency: Currency = "NOK"): string {
  return new Intl.NumberFormat(currency === "NOK" ? "nb-NO" : "de-DE", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
