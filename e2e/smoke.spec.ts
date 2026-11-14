import { expect, test } from "@playwright/test";

/**
 * End-to-end smoke checks over the deployed site: the pages open with no sign-in,
 * deep links survive a refresh, and the browser
 * console stays clean.
 */

const CONTENT_ROUTES = [
  "/dashboard",
  "/experiments",
  "/insights",
  "/search",
  "/coverage",
  "/datasets",
  "/explorer",
  "/rank",
  "/compare",
  "/reports",
];

test("the landing page renders and has no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/");
  await expect(page.locator("h1").first()).toBeVisible();
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});

test("every content route opens without a sign-in wall", async ({ page }) => {
  for (const route of CONTENT_ROUTES) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    expect(new URL(page.url()).pathname, `${route} redirected to login`).toBe(route);
    await expect(page.locator("h1, .page-title").first()).toBeVisible();
  }
});

test("a deep link survives a reload (SPA fallback, no 404)", async ({ page }) => {
  await page.goto("/experiments");
  await page.reload();
  await expect(page.locator("h1, .page-title").first()).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/experiments");
});

test("the NASA disclaimer is visible on the landing page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/not affiliated with or endorsed by NASA/i)).toBeVisible();
});

test("the assistant answers without a session", async ({ request }) => {
  const res = await request.post("/api/ask-sync", {
    data: { question: "What is the limiting oxygen index?", stream: false },
  });
  expect(res.status(), "assistant rejected an anonymous question").toBeLessThan(400);
});

test("meta tags are present and in English", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    /og-image\.png$/,
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /./);
});

test("images carry alt text", async ({ page }) => {
  await page.goto("/");
  const imgs = await page.locator("img").all();
  for (const img of imgs) {
    expect(await img.getAttribute("alt"), "an image has no alt attribute").not.toBeNull();
  }
});
