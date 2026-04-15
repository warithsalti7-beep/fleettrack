import { test, expect, Page, request as pwRequest } from "@playwright/test";

// These credentials are the defaults from /api/auth/bootstrap. The test
// DB should have been bootstrapped with them via:
//   curl -X POST -H "X-Admin-Token: $SEED_TOKEN" http://localhost:3000/api/auth/bootstrap
const DEMO = {
  admin:    { email: "admin@fleettrack.no",    password: "Admin2024!" },
  employee: { email: "employee@fleettrack.no", password: "Employee2024!" },
  driver:   { email: "driver@fleettrack.no",   password: "Driver2024!" },
};

function failOnConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return () => {
    // Filter out Sentry-CDN noise that isn't actionable in tests.
    const real = errors.filter((e) => !/sentry-cdn|Failed to load resource/i.test(e));
    if (real.length) {
      throw new Error("Console errors:\n" + real.join("\n"));
    }
  };
}

test.describe("Smoke", () => {
  test("landing page loads and shows the login form", async ({ page }) => {
    const assertNoErrors = failOnConsoleErrors(page);
    await page.goto("/");
    await expect(page).toHaveTitle(/FleetTrack/);
    await expect(page.locator("form#login-form")).toBeVisible();
    assertNoErrors();
  });

  test("admin can sign in and reach the dashboard", async ({ page }) => {
    const assertNoErrors = failOnConsoleErrors(page);
    await page.goto("/login");
    await page.getByText("Admin", { exact: true }).first().click();
    await page.fill("#email", DEMO.admin.email);
    await page.fill("#password", DEMO.admin.password);
    await page.click("#login-btn");
    await page.waitForURL(/dashboard/);
    await expect(page.locator(".sidebar")).toBeVisible({ timeout: 10_000 });
    assertNoErrors();
  });

  test("driver portal rejects admin role", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#email", DEMO.admin.email);
    await page.fill("#password", DEMO.admin.password);
    await page.click("#login-btn");
    await page.waitForURL(/dashboard/);
    await page.goto("/driver");
    // driver.html's requireAuth(['driver']) should redirect admin away
    await page.waitForURL(/login/, { timeout: 5_000 });
  });

  test("bad password returns 401, not a silent success", async ({ request }) => {
    const r = await request.post("/api/auth/login", {
      data: { email: DEMO.admin.email, password: "not-the-real-password" },
    });
    expect(r.status()).toBe(401);
    const body = await r.json();
    expect(body.error).toBe("invalid_credentials");
  });

  test("API routes reject unauthenticated calls", async () => {
    // Use a fresh request context so we don't inherit browser cookies.
    const ctx = await pwRequest.newContext();
    const paths = ["/api/drivers", "/api/vehicles", "/api/trips", "/api/stats", "/api/export/drivers"];
    for (const p of paths) {
      const r = await ctx.get(p);
      expect([401, 429], `${p} should 401 for no-cookie; got ${r.status()}`).toContain(r.status());
    }
    await ctx.dispose();
  });

  test("rate limiter kicks in on repeated bad logins", async ({ request }) => {
    // Auth bucket is 10/min per IP. Fire 12 bad logins; at least one must
    // be rejected with 429 (sometimes the earlier 10 all succeed depending
    // on whether another test ran in the same window, so we just assert
    // "at least one 429").
    let saw429 = false;
    for (let i = 0; i < 12; i++) {
      const r = await request.post("/api/auth/login", {
        data: { email: "nobody@example.com", password: "wrong" },
      });
      if (r.status() === 429) { saw429 = true; break; }
    }
    expect(saw429).toBe(true);
  });
});
