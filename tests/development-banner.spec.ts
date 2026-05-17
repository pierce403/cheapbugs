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

test("submit route defaults to the broker XMTP path", async ({ page }) => {
  await page.goto("/submit");

  await expect(page.getByText("xmtp broker wallet: 0xea6995fc3674e1e94736766f5eeefb0506e4ef32")).toBeVisible();
  await expect(page.getByTestId("xmtp-status")).toContainText("xmtp: wallet required");
  await expect(page.getByRole("button", { name: "submit to broker" })).toBeEnabled();
  for (const removedLabel of [
    "repro steps",
    "evidence",
    "suggested severity",
    "signal recipient",
    "contact hints",
    "target kind",
    "disclosure mode",
    "target reference",
    "tags",
    "review access key",
    "regen"
  ]) {
    await expect(page.getByText(removedLabel, { exact: true })).toHaveCount(0);
  }
});

test("submit route gives inline XMTP feedback when submit is blocked", async ({ page }) => {
  await page.goto("/submit");

  await page.getByLabel("title").fill("Parser overflow");
  await page.getByLabel("public summary").fill("Public safe summary for reviewers.");
  await page.getByLabel("details").fill("Private details for the broker only.");
  await page.getByRole("button", { name: "submit to broker" }).click();

  await expect(page).toHaveURL(/\/submit$/);
  await expect(page.getByTestId("xmtp-status")).toContainText("xmtp: wallet required");
  await expect(page.getByTestId("xmtp-status")).toContainText(
    "Connect a local XMTP wallet or compatible external wallet before submitting."
  );
});
