import { expect, type Page, test } from "@playwright/test";
import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";

async function signInAsOwner(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(DEV_STAFF_LOGINS.owner.email);
  await page.getByLabel("Password").fill(DEV_STAFF_LOGINS.owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/shop/);
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Staff schedules a fresh trip and a visitor books it; returns the trip title. */
async function scheduleAndBook(page: Page, label: string): Promise<string> {
  const title = `${label} ${Date.now()}`;
  await signInAsOwner(page);
  await page.goto("/shop/trips/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Date").fill(daysFromNow(9));
  await page.getByLabel("Departs").fill("08:00");
  await page.getByLabel("Returns").fill("11:30");
  await page.getByLabel("Capacity").fill("6");
  await page.getByRole("button", { name: "Put it on the board" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/); // wait for sign-out to land before navigating

  await page.goto("/trips");
  await page.locator("li").filter({ hasText: title }).getByRole("link").click();
  await page.getByLabel("Name").fill("Nora Quinn");
  await page.getByLabel("Email").fill(`nora-${Date.now()}@example.com`);
  await page.getByRole("button", { name: /Book/ }).click();
  await expect(page.getByRole("heading", { name: /You're on the boat, Nora/ })).toBeVisible();
  return title;
}

test("diver books, signs the waiver, and staff sees it signed", async ({ page }) => {
  test.slow(); // long flow across several routes that compile lazily on the dev server
  const title = await scheduleAndBook(page, "Waiver Reef");

  // The confirmation hands the diver their waiver link.
  await page.getByRole("link", { name: "Complete your waiver" }).click();
  await expect(page.getByRole("heading", { name: /Let's get you dive-ready/ })).toBeVisible();

  // Acknowledge, answer every medical question "No", and sign.
  await page.getByRole("checkbox").check();
  for (const radio of await page.locator('input[value="no"]').all()) await radio.check();
  await page.getByRole("button", { name: "Sign my waiver" }).click();
  await expect(page.getByRole("heading", { name: /All set/ })).toBeVisible();

  // Staff roster reflects the signed waiver.
  await signInAsOwner(page);
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await expect(page.getByText("Waiver signed")).toBeVisible();
});

test("a yes on the medical statement fails closed to a referral", async ({ page }) => {
  test.slow(); // long flow across several routes that compile lazily on the dev server
  await scheduleAndBook(page, "Waiver Referral");

  await page.getByRole("link", { name: "Complete your waiver" }).click();
  await page.getByRole("checkbox").check();
  for (const radio of await page.locator('input[value="no"]').all()) await radio.check();
  // Flip one answer to "yes" — that's a physician-referral trigger.
  await page.locator('input[value="yes"]').first().check();
  await page.getByRole("button", { name: "Sign my waiver" }).click();

  await expect(page.getByRole("heading", { name: /One quick step first/ })).toBeVisible();
  await expect(page.getByText(/physician's sign-off/)).toBeVisible();
});
