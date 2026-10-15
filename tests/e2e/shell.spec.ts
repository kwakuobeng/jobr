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

test("anonymous protected routes redirect to sign-in", async ({ page }) => {
  await page.goto("/matches?query=engineer");
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  await expect(page.getByRole("heading", { name: "Sign in to Jobr" })).toBeVisible();
});


test("anonymous resume route redirects to sign-in", async ({ page }) => {
  await page.goto("/resume");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fresume/);
  await expect(page.getByRole("heading", { name: "Sign in to Jobr" })).toBeVisible();
});
