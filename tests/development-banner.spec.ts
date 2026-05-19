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
    await expect(banner.locator("strong")).toHaveCSS("color", "rgb(255, 154, 71)");
    await expect(banner).toHaveCSS("border-top-color", "rgba(255, 106, 0, 0.58)");
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
  await expect(brandBlock.getByTestId("build-badge")).toHaveText(/^build [a-z0-9]{3,12} \/ .+/i);
});

test("mobile header keeps navigation as stable tap targets", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  const nav = page.locator(".nav-row");
  const links = nav.locator(".nav-link");
  await expect(nav).toHaveCSS("display", "grid");
  await expect(links).toHaveCount(7);
  await expect(page.locator(".brand")).toHaveText("cheapbugs");

  const boxes = await links.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        text: node.textContent?.trim() ?? ""
      };
    })
  );
  const rows = new Map<number, typeof boxes>();
  for (const box of boxes) {
    rows.set(box.top, [...(rows.get(box.top) ?? []), box]);
    expect(box.height).toBeGreaterThanOrEqual(34);
  }

  const firstRow = rows.get(boxes[0].top) ?? [];
  expect(firstRow).toHaveLength(1);
  expect(boxes[0].text).toBe("index");
  expect(boxes[0].width).toBeGreaterThan(boxes[1].width * 1.8);
  expect(Math.max(...Array.from(rows.values()).map((row) => row.length))).toBeLessThanOrEqual(2);
  expect(boxes.at(-1)?.text).toBe("patrons");
  expect(boxes.at(-1)?.width).toBeLessThan(boxes[0].width * 0.75);
});

test("submit route defaults to the broker XMTP path", async ({ page }) => {
  await page.goto("/submit");

  await expect(page.getByText("xmtp broker wallet: 0xea6995fc3674e1e94736766f5eeefb0506e4ef32")).toBeVisible();
  await expect(page.getByTestId("xmtp-status")).toContainText("xmtp: wallet required");
  await expect(page.getByRole("button", { name: "submit to broker" })).toBeEnabled();
  await expect(page.locator("#submit-form label").nth(0)).toContainText("title");
  await expect(page.locator("#submit-form label").nth(1)).toContainText("target");
  await expect(page.locator("#submit-form label").nth(2)).toContainText("bug type");
  await expect(page.getByLabel("title")).toHaveAttribute("minlength", "3");
  await expect(page.getByLabel("title")).toHaveAttribute("maxlength", "120");
  await expect(page.getByRole("textbox", { name: "target" })).toHaveAttribute("minlength", "2");
  await expect(page.getByRole("textbox", { name: "target" })).toHaveAttribute("maxlength", "160");
  await expect(page.getByLabel("public summary")).toHaveAttribute("minlength", "10");
  await expect(page.getByLabel("public summary")).toHaveAttribute("maxlength", "2000");
  await expect(page.getByLabel("private details")).toHaveAttribute("minlength", "10");
  await expect(page.getByLabel("private details")).toHaveAttribute("maxlength", "12000");
  await expect(page.getByText("must include full step-by-step instructions and/or PoC")).toBeVisible();
  await expect(page.getByLabel("bug type")).toHaveValue("0day");
  await expect(page.getByLabel("bug type").locator('option[value="web3"]')).toHaveText(
    "web3 : bug in smart contracts, wallets, dapps, or onchain protocols"
  );
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
    "tags",
    "review access key",
    "regen"
  ]) {
    await expect(page.getByText(removedLabel, { exact: true })).toHaveCount(0);
  }
});

test("submit route validates broker field sizes before wallet checks", async ({ page }) => {
  await page.goto("/submit");

  await page.getByLabel("title").fill("Parser overflow");
  await page.getByRole("textbox", { name: "target" }).fill("base parser");
  await page.getByLabel("public summary").fill("short");
  await page.getByLabel("private details").fill("Private details for the broker only.");
  await page.getByRole("button", { name: "submit to broker" }).click();

  await expect(page.getByTestId("xmtp-status")).toContainText("form: check fields");
  await expect(page.getByTestId("xmtp-status")).toContainText(
    "Public summary must be at least 10 characters after trimming."
  );
  await expect(page.getByRole("dialog", { name: "processing submission" })).toBeHidden();

  await page.getByLabel("public summary").fill("Public safe summary for reviewers.");
  await page.getByLabel("private details").fill("tiny");
  await page.getByRole("button", { name: "submit to broker" }).click();

  await expect(page.getByTestId("xmtp-status")).toContainText("form: check fields");
  await expect(page.getByTestId("xmtp-status")).toContainText(
    "Private details must be at least 10 characters after trimming."
  );
});

test("submit route gives inline XMTP feedback when submit is blocked", async ({ page }) => {
  await page.goto("/submit");

  await page.getByLabel("title").fill("Parser overflow");
  await page.getByRole("textbox", { name: "target" }).fill("base parser");
  await page.getByLabel("public summary").fill("Public safe summary for reviewers.");
  await page.getByLabel("private details").fill("Private details for the broker only.");
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

test("submit route shows a wallet-device wait modal during PublishBug signing", async ({ page }) => {
  await page.goto("/submit");

  await page.locator("[data-view-root]").evaluate((root) => {
    root.dispatchEvent(
      new CustomEvent("cheapbugs:xmtp-progress", {
        detail: { message: "waiting for PublishBug EIP-712 signature" }
      })
    );
  });

  const dialog = page.getByRole("dialog", { name: "wallet signature" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("waiting for signature from wallet device");
  await expect(dialog).toContainText("Approve the CheapBugs PublishBug authorization");

  await page.locator("[data-view-root]").evaluate((root) => {
    root.dispatchEvent(
      new CustomEvent("cheapbugs:xmtp-progress", {
        detail: { message: "PublishBug authorization approved" }
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
  await expect(dialog).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("xmtp-status")).toContainText("broker: IPFS pinned");

  await page.locator("[data-view-root]").evaluate((root) => {
    root.dispatchEvent(
      new CustomEvent("cheapbugs:xmtp-progress", {
        detail: {
          message:
            "broker: Submission complete: Bug published onchain: report 0x1111111111111111111111111111111111111111111111111111111111111111 tx 0x2222222222222222222222222222222222222222222222222222222222222222. Signal is not configured."
        }
      })
    );
  });

  await expect(dialog).toHaveAttribute("aria-busy", "false");
  await expect(page.getByTestId("xmtp-status")).toContainText("broker: onchain live");
  await dialog.getByRole("button", { name: "close" }).click();
  await expect(dialog).toBeHidden();
});
