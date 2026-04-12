"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { Currency } from "@/lib/currency";
import { CURRENCY_COOKIE } from "@/lib/currency";

export async function setCurrencyAction(currency: Currency) {
  const cookieStore = await cookies();
  cookieStore.set(CURRENCY_COOKIE, currency, {
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  revalidatePath("/dashboard", "layout");
}
