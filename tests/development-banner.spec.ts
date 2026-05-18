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
  const expectedBuildTime = await page.evaluate(() =>
    new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short"
    }).format(new Date("2026-05-17T19:34:56.000Z"))
  );
  await expect(brandBlock.locator(".brand")).toHaveText("cheapbugs");
  await expect(brandBlock.getByText("github", { exact: true })).toHaveCount(0);
  await expect(brandBlock.getByRole("link", { name: "GitHub repository" })).toHaveAttribute(
    "href",
    "https://github.com/pierce403/cheapbugs"
  );
  await expect(brandBlock.locator(".brand-github-icon")).toBeVisible();
  await expect(brandBlock.getByTestId("build-badge")).toHaveText(`build testbuild123 / ${expectedBuildTime}`);
});

test("submit route defaults to the broker XMTP path", async ({ page }) => {
  await page.goto("/submit");

  await expect(page.getByText("xmtp broker wallet: 0xea6995fc3674e1e94736766f5eeefb0506e4ef32")).toBeVisible();
  await expect(page.getByTestId("xmtp-status")).toContainText("xmtp: wallet required");
  await expect(page.getByRole("button", { name: "submit to broker" })).toBeEnabled();
  await expect(page.locator("#submit-form label").nth(0)).toContainText("title");
  await expect(page.locator("#submit-form label").nth(1)).toContainText("bug type");
  await expect(page.getByLabel("bug type")).toHaveValue("0day");
  await expect(page.getByLabel("severity")).toHaveValue("1");
  await expect(page.locator("#severity-output")).toHaveText("medium");
  await expect(page.getByLabel("target interest")).toHaveValue("1");
  await expect(page.locator("#targetInterest-output")).toHaveText("medium");
  await page.getByLabel("target interest").evaluate((node: HTMLInputElement) => {
    node.value = "3";
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#targetInterest-output")).toHaveText("critical");
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

test("submit route shows a wallet-device wait modal during XMTP signature requests", async ({ page }) => {
  await page.goto("/submit");

  await page.locator("[data-view-root]").evaluate((root) => {
    root.dispatchEvent(
      new CustomEvent("cheapbugs:xmtp-progress", {
        detail: { message: "waiting for XMTP wallet signature" }
      })
    );
  });

  const dialog = page.getByRole("dialog", { name: "wallet signature" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("waiting for signature from wallet device");
  await expect(dialog).toContainText("Approve the XMTP registration signature");
  await expect(page.getByRole("dialog", { name: "processing submission" })).toBeVisible();

  await page.locator("[data-view-root]").evaluate((root) => {
    root.dispatchEvent(
      new CustomEvent("cheapbugs:xmtp-progress", {
        detail: { message: "XMTP wallet signature approved" }
      })
    );
  });

  await expect(dialog).toBeHidden();
});

test("submit route shows a processing modal during broker submission progress", async ({ page }) => {
  await page.goto("/submit");

  const dialog = page.getByRole("dialog", { name: "processing submission" });
  await expect(dialog).toBeHidden();

  await page.locator("[data-view-root]").evaluate((root) => {
    root.dispatchEvent(
      new CustomEvent("cheapbugs:xmtp-progress", {
        detail: { message: "opening broker DM" }
      })
    );
  });

  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("processing submission");
  await expect(dialog).toContainText("opening broker DM");

  await page.locator("[data-view-root]").evaluate((root) => {
    root.dispatchEvent(
      new CustomEvent("cheapbugs:xmtp-progress", {
        detail: { message: "broker: Encrypted BugBundle pinned to IPFS: ipfs://bafybrokerbundle." }
      })
    );
  });

  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("ipfs://bafybrokerbundle");
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  await expect(page.getByTestId("xmtp-status")).toContainText("broker: IPFS live");
  await dialog.getByRole("button", { name: "close" }).click();
  await expect(dialog).toBeHidden();
});
