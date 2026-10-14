import { test, expect } from "@playwright/test";
test("foundation shell is accessible and fits the viewport", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Jobr", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("matches link opens the server-rendered empty state", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Explore matches" }).click();
  await expect(page).toHaveURL(/\/matches$/);
  await expect(
    page.getByRole("heading", { name: "Your matches", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your next opportunity starts here" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
