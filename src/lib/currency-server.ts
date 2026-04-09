import { cookies } from "next/headers";
import { CURRENCY_COOKIE } from "./currency";
import type { Currency } from "./currency";

export async function getCurrency(): Promise<Currency> {
  const cookieStore = await cookies();
  const value = cookieStore.get(CURRENCY_COOKIE)?.value;
  return value === "EUR" ? "EUR" : "NOK";
}
