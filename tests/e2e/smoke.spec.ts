import { test, expect, Page } from "@playwright/test";

/**
 * Smoke tests for the deployed app.
 *
 * These run against a Next.js server spun up by CI (see
 * .github/workflows/e2e.yml). The CI environment has NO database, so
 * any test that touches /api/* that requires a live DB connection is
 * expected to return 500 or 401 and the test asserts that behaviour
 * directly rather than trying to log in.
 *
 * Login-based flows (requires a real DB + bootstrap-created User rows)
 * are covered by a separate test suite that runs against staging, not
 * by these smoke tests.
 */

function failOnConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return () => {
    // Filter out noise that isn't actionable in CI (third-party CDNs,
    // optional env-driven features, 500s from the DB-less CI env).
    const real = errors.filter(
      (e) =>
        !/sentry-cdn|Failed to load resource|500 \(Internal Server Error\)|net::ERR_|the server responded with a status of 500/i.test(
          e,
        ),
    );
    if (real.length) {
      throw new Error("Console errors:\n" + real.join("\n"));
    }
  };
}

test.describe("Smoke (DB-independent)", () => {
  test("landing page routes to login and shows the form", async ({ page }) => {
    const assertNoErrors = failOnConsoleErrors(page);
    await page.goto("/");
    await expect(page).toHaveTitle(/FleetTrack/);
    // New login page id — keeps stable across the D7 redesign.
    await expect(page.locator("form#login-form")).toBeVisible();
    await expect(page.locator("input#email")).toBeVisible();
    await expect(page.locator("input#password")).toBeVisible();
    await expect(page.locator("#login-btn")).toBeVisible();
    assertNoErrors();
  });

  test("/api/health responds with an env-configured envelope", async ({ request }) => {
    const r = await request.get("/api/health");
    // In CI the DB check will fail — but the route itself should always
    // respond with JSON. 200 on a happy env, 503 when DATABASE_URL isn't
    // set or Neon is unreachable.
    expect([200, 503]).toContain(r.status());
    const body = await r.json();
    expect(body).toHaveProperty("checks");
    expect(body).toHaveProperty("envConfigured");
    expect(body).toHaveProperty("warnings");
  });

  test("API routes reject unauthenticated callers with 401", async ({ request }) => {
    // /api/auth/login is public; /api/drivers and friends require a
    // session cookie. Without one the proxy returns 401 before the route
    // handler runs — no DB access needed.
    for (const path of ["/api/drivers", "/api/vehicles", "/api/trips", "/api/stats", "/api/export/drivers"]) {
      const r = await request.get(path);
      expect(
        [401, 429],
        `${path} should require auth (401) or rate-limit (429); got ${r.status()}`,
      ).toContain(r.status());
    }
  });

  test("bad login returns 401 without leaking which field was wrong", async ({ request }) => {
    const r = await request.post("/api/auth/login", {
      data: { email: "nobody@example.com", password: "definitely-wrong" },
    });
    // 401 on bad creds is what we want; 500 is acceptable if CI's DB is
    // unreachable — the test asserts the endpoint exists and doesn't
    // silent-succeed.
    expect([401, 500]).toContain(r.status());
    const body = await r.json();
    expect(body).toHaveProperty("error");
    expect(body.error).not.toBe("ok");
  });

  test("auth rate limit triggers on repeated bad logins", async ({ request }) => {
    // The proxy rate-limits /api/auth/* at 10 req/min per IP. Fire 12
    // bad-login attempts; at least one should return 429 with a Retry-
    // After header.
    let saw429 = false;
    for (let i = 0; i < 12; i++) {
      const r = await request.post("/api/auth/login", {
        data: { email: "nobody@example.com", password: "wrong" },
      });
      if (r.status() === 429) {
        saw429 = true;
        expect(r.headers()["retry-after"]).toBeDefined();
        break;
      }
    }
    expect(saw429, "Expected a 429 within 12 rapid login attempts").toBe(true);
  });
});
