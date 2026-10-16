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

for (const route of ["/app", "/preferences"]) {
  test(`anonymous ${route} route redirects safely`, async ({ page }) => {
    await page.goto(route);
    await expect(page).toHaveURL(new RegExp(`/sign-in\\?next=${encodeURIComponent(route)}`));
    await expect(page.getByRole("heading", { name: "Sign in to Jobr" })).toBeVisible();
  });
}

test("public health endpoint responds", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});

test("auth forms expose required fields and preserve a safe destination", async ({ page }) => {
  await page.goto("/sign-in?next=%2Fresume");
  await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("required", "");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("minlength", "8");
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page).toHaveURL(/sign-up\?next=%2Fresume/);
  await expect(page.getByRole("heading", { name: "Create your Jobr account" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
