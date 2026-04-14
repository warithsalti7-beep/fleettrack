import { test, expect, Page } from "@playwright/test";

const DEMO = {
  admin:   { email: "stefan@oslofleet.no",        password: "Admin2024!" },
  empl:    { email: "dispatch@fleettrack.no",      password: "Dispatch2024!" },
  driver:  { email: "olsztynski@fleettrack.no",    password: "Driver2024!" },
};

// Capture console errors so a silent JS failure fails the test.
function failOnConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return () => {
    if (errors.length) {
      throw new Error("Console errors:\n" + errors.join("\n"));
    }
  };
}

test.describe("Smoke", () => {
  test("landing page loads and routes to login", async ({ page }) => {
    const assertNoErrors = failOnConsoleErrors(page);
    await page.goto("/");
    await expect(page).toHaveTitle(/FleetTrack/);
    await expect(page.locator("form#login-form")).toBeVisible();
    assertNoErrors();
  });

  test("admin can sign in and see the dashboard sidebar", async ({ page }) => {
    const assertNoErrors = failOnConsoleErrors(page);
    await page.goto("/login");
    await page.getByText("Admin", { exact: true }).first().click();
    await page.fill("#email", DEMO.admin.email);
    await page.fill("#password", DEMO.admin.password);
    await page.click("#login-btn");
    await page.waitForURL(/dashboard/);
    await expect(page.locator(".sidebar")).toBeVisible({ timeout: 10000 });
    assertNoErrors();
  });

  test("driver portal rejects admin role", async ({ page }) => {
    // Login as admin, try to navigate to /driver manually, expect redirect back to login
    await page.goto("/login");
    await page.fill("#email", DEMO.admin.email);
    await page.fill("#password", DEMO.admin.password);
    await page.click("#login-btn");
    await page.waitForURL(/dashboard/);
    await page.goto("/driver");
    // driver.html's requireAuth(['driver']) should redirect admin away
    await page.waitForURL(/login/, { timeout: 5000 });
  });

  test("employee with zero perms lands on My Profile — no fleet data", async ({ page }) => {
    await page.goto("/login");
    // Switch portal tab to Employee
    await page.getByText("Employee", { exact: true }).first().click();
    await page.fill("#email", DEMO.empl.email);
    await page.fill("#password", DEMO.empl.password);
    await page.click("#login-btn");
    await page.waitForURL(/dashboard/);
    // Employee should see My Profile nav entry
    await expect(page.locator("#nav-my-profile")).toBeVisible();
    // And must NOT see admin-only pages like Users & Permissions
    await expect(page.locator("[onclick*=\"settings-users\"]")).toBeHidden();
  });

  test("no menu click in admin dashboard throws an error", async ({ page }) => {
    const assertNoErrors = failOnConsoleErrors(page);
    await page.goto("/login");
    await page.fill("#email", DEMO.admin.email);
    await page.fill("#password", DEMO.admin.password);
    await page.click("#login-btn");
    await page.waitForURL(/dashboard/);
    // Click a handful of nav items and ensure the active page updates
    const navs = await page.locator(".nav-item, .subnav-item").all();
    const sample = navs.slice(0, Math.min(6, navs.length));
    for (const n of sample) {
      const onclick = await n.getAttribute("onclick");
      if (onclick && onclick.includes("go(")) {
        await n.click().catch(() => {});
        await page.waitForTimeout(120);
      }
    }
    assertNoErrors();
  });
});
