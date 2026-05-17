import { expect, test } from "@playwright/test";

const expectedBannerText = [
  "development preview",
  "CheapBugs is under development, so some features might not work as expected.",
  "Expected launch: June 1, 2026."
];

test("shows the development banner across app routes", async ({ page }) => {
  for (const path of ["/", "/submit"]) {
    await page.goto(path);
    const banner = page.getByTestId("development-banner");

    await expect(banner).toBeVisible();
    for (const text of expectedBannerText) {
      await expect(banner).toContainText(text);
    }
  }
});

test("shows the GitHub repository icon link beside the brand", async ({ page }) => {
  await page.goto("/");

  const brandBlock = page.locator(".brand-block");
  await expect(brandBlock.locator(".brand")).toHaveText("cheapbugs");
  await expect(brandBlock.getByText("github", { exact: true })).toHaveCount(0);
  await expect(brandBlock.getByRole("link", { name: "GitHub repository" })).toHaveAttribute(
    "href",
    "https://github.com/pierce403/cheapbugs"
  );
  await expect(brandBlock.locator(".brand-github-icon")).toBeVisible();
});
