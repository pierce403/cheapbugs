import { expect, test, type Page, type Route } from "@playwright/test";
import { AbiCoder, Interface, id } from "ethers";

import { bugIndexAbi } from "../src/contracts/bugIndexAbi";

const bugIndexAddress = "0x515FDbc9876aC26870794E26605c7DD04c18679b";
const reporterAddress = "0x1234567890123456789012345678901234567890";
const reportHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const zeroBytes32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const abiCoder = AbiCoder.defaultAbiCoder();
const bugIndexInterface = new Interface(bugIndexAbi);
const latestReportHashesSelector = bugIndexInterface.getFunction("latestReportHashes")?.selector;
const getReportSelector = bugIndexInterface.getFunction("getReport")?.selector;
const reverseSelector = id("reverseWithGateways(bytes,uint256,string[])").slice(0, 10);
const resolveSelector = id("resolveWithGateways(bytes,bytes,string[])").slice(0, 10);
const zeroAddress = "0x0000000000000000000000000000000000000000";
const revealDelayMs = 2 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000 + 30 * 60 * 1000;

const revealAfterDate = () => new Date(Date.now() + revealDelayMs);

type RpcRequest = {
  id: number | string | null;
  jsonrpc: "2.0";
  method: string;
  params?: unknown[];
};

type RpcResponse = {
  id: number | string | null;
  jsonrpc: "2.0";
  result: unknown;
};

const reportTuple = () => {
  const createdAt = 1_779_120_000n;
  const revealAfter = BigInt(Math.floor(revealAfterDate().getTime() / 1000));
  return [
    reportHash,
    "CB-LIVE-0001",
    reporterAddress,
    createdAt,
    2,
    "Fresh broker-published bug from chain.",
    "ipfs://bafyrecentbug",
    4,
    id("base-protocol"),
    "base, parser",
    id("public-content"),
    id("bug-bundle"),
    id("encrypted-details"),
    id("details-key"),
    revealAfter,
    zeroBytes32,
    false,
    0,
    false,
    0n,
    0
  ];
};

const submissionPublic = () => ({
  reportId: "CB-LIVE-0001",
  reportHash,
  reporterAddress,
  createdAt: new Date(1_779_120_000 * 1000).toISOString(),
  disclosureMode: "public",
  publicSummary: "Fresh broker-published bug from chain.",
  encryptedPayloadCid: "ipfs://bafyrecentbug",
  targetKind: "protocol",
  targetRefHash: id("base-protocol"),
  tags: ["base", "parser"],
  contentHash: id("public-content"),
  revealAfter: revealAfterDate().toISOString(),
  detailsKeyRevealed: false
});

const bugBundlePayload = () => ({
  schema: "cheapbugs.bug_bundle.v1",
  version: 1,
  core: {
    submission: {
      title: "Live parser exploit",
      target: {
        kind: "protocol",
        reference: "Base protocol parser"
      }
    }
  }
});

const mockBaseRpc = async (page: Page): Promise<{ counts: { latest: number; getReport: number } }> => {
  const counts = { latest: 0, getReport: 0 };

  await page.route("https://mainnet.base.org/**", async (route: Route) => {
    const payload = JSON.parse(route.request().postData() || "{}") as RpcRequest | RpcRequest[];
    const requests = Array.isArray(payload) ? payload : [payload];

    const responses = requests.map((request): RpcResponse => {
      if (request.method === "eth_chainId") {
        return { id: request.id, jsonrpc: "2.0", result: "0x2105" };
      }

      if (request.method === "net_version") {
        return { id: request.id, jsonrpc: "2.0", result: "8453" };
      }

      if (request.method === "eth_call") {
        const call = (request.params?.[0] ?? {}) as { data?: string; to?: string };
        const selector = call.data?.slice(0, 10).toLowerCase();
        const target = call.to?.toLowerCase();

        if (target === bugIndexAddress.toLowerCase() && selector === latestReportHashesSelector) {
          counts.latest += 1;
          return {
            id: request.id,
            jsonrpc: "2.0",
            result: bugIndexInterface.encodeFunctionResult("latestReportHashes", [[reportHash]])
          };
        }

        if (target === bugIndexAddress.toLowerCase() && selector === getReportSelector) {
          counts.getReport += 1;
          return {
            id: request.id,
            jsonrpc: "2.0",
            result: bugIndexInterface.encodeFunctionResult("getReport", [reportTuple()])
          };
        }

        if (selector === "0x70a08231") {
          return {
            id: request.id,
            jsonrpc: "2.0",
            result: abiCoder.encode(["uint256"], [420n * 10n ** 18n])
          };
        }
      }

      return { id: request.id, jsonrpc: "2.0", result: "0x" };
    });

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(Array.isArray(payload) ? responses : responses[0])
    });
  });

  return { counts };
};

const mockEnsRpc = async (page: Page): Promise<void> => {
  await page.route("https://ethereum-rpc.publicnode.com/**", async (route: Route) => {
    const payload = JSON.parse(route.request().postData() || "{}") as RpcRequest | RpcRequest[];
    const requests = Array.isArray(payload) ? payload : [payload];
    const responses = requests.map((request): RpcResponse => {
      if (request.method === "eth_chainId") {
        return { id: request.id, jsonrpc: "2.0", result: "0x1" };
      }

      if (request.method === "eth_call") {
        const call = (request.params?.[0] ?? {}) as { data?: string };
        const selector = call.data?.slice(0, 10).toLowerCase();
        if (selector === reverseSelector) {
          return {
            id: request.id,
            jsonrpc: "2.0",
            result: abiCoder.encode(["string", "address", "address"], ["alice.eth", zeroAddress, zeroAddress])
          };
        }

        if (selector === resolveSelector) {
          const avatarResult = abiCoder.encode(["string"], [""]);
          return {
            id: request.id,
            jsonrpc: "2.0",
            result: abiCoder.encode(["bytes", "address"], [avatarResult, zeroAddress])
          };
        }
      }

      return { id: request.id, jsonrpc: "2.0", result: "0x" };
    });

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(Array.isArray(payload) ? responses : responses[0])
    });
  });
};

const mockBugBundleGateway = async (page: Page): Promise<{ counts: { bundle: number } }> => {
  const counts = { bundle: 0 };
  await page.route("https://ipfs.io/ipfs/bafyrecentbug", async (route) => {
    counts.bundle += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(bugBundlePayload())
    });
  });

  return { counts };
};

const seedExpiredReportCaches = async (page: Page): Promise<void> => {
  await page.addInitScript(
    ({ address, hash, report, bundle }) => {
      const expiredRecord = (value: unknown) =>
        JSON.stringify({
          value,
          expiresAt: Date.now() - 1
        });

      window.localStorage.setItem(`cheapbugs.bugIndex.v2:latest:${address}:12`, expiredRecord([report]));
      window.localStorage.setItem(`cheapbugs.bugIndex.v2:report:${address}:${hash}`, expiredRecord(report));
      window.localStorage.setItem("cheapbugs.ipfs:ipfs-gateway:ipfs://bafyrecentbug", expiredRecord(bundle));
    },
    {
      address: bugIndexAddress,
      hash: reportHash,
      report: submissionPublic(),
      bundle: bugBundlePayload()
    }
  );
};

test("renders newly indexed onchain bugs in recent reports", async ({ page }) => {
  const { counts } = await mockBaseRpc(page);
  await mockEnsRpc(page);
  const gateway = await mockBugBundleGateway(page);

  await page.goto("/");

  await expect(page.getByText("public goods crowdfunding protocol")).toBeVisible();
  await expect(page.getByText(`bug index: ${bugIndexAddress}`)).toHaveCount(0);
  await expect(page.getByText("bond vault:")).toHaveCount(0);
  await expect(page.getByText("treasury vault:")).toHaveCount(0);
  await expect(page.getByText("[ patrons of the arts ]")).toHaveCount(0);
  await expect(page.getByText("static assets only")).toHaveCount(0);

  const recentReports = page.locator("section").filter({ hasText: "[ recent reports ]" });
  await expect(recentReports.locator("thead th")).toHaveText(["date", "title", "target", "author", "details"]);
  const reportRow = recentReports.getByRole("row").filter({ hasText: "Live parser exploit" });
  await expect(reportRow.locator("td").nth(0)).toContainText("May 18, 2026");
  await expect(reportRow.locator("td").nth(1)).toContainText("Live parser exploit");
  await expect(reportRow).toContainText("Base protocol parser (protocol)");
  await expect(reportRow).toContainText("alice.eth");
  await expect(reportRow.locator("td").nth(4)).toHaveText("2d 4h");
  await expect(recentReports.getByText("No onchain bug reports resolved yet.")).toHaveCount(0);

  expect(counts.latest).toBeGreaterThan(0);
  expect(counts.getReport).toBeGreaterThan(0);
  expect(gateway.counts.bundle).toBe(1);

  const countsAfterFirstRender = { ...counts };
  const gatewayCallsAfterFirstRender = gateway.counts.bundle;
  await page.getByRole("link", { name: "submit" }).click();
  await expect(page).toHaveURL(/\/submit$/);
  await page.getByRole("link", { name: "index" }).click();
  await expect(reportRow.locator("td").nth(1)).toContainText("Live parser exploit");
  await expect(reportRow.locator("td").nth(4)).toHaveText("2d 4h");
  expect(counts).toEqual(countsAfterFirstRender);
  expect(gateway.counts.bundle).toBe(gatewayCallsAfterFirstRender);

  await page.reload();
  const reloadedRecentReports = page.locator("section").filter({ hasText: "[ recent reports ]" });
  const reloadedReportRow = reloadedRecentReports.getByRole("row").filter({ hasText: "Live parser exploit" });
  await expect(reloadedReportRow).toContainText("Base protocol parser (protocol)");
  await expect(reloadedReportRow.locator("td").nth(4)).toHaveText("2d 4h");
  expect(counts).toEqual(countsAfterFirstRender);
  expect(gateway.counts.bundle).toBe(gatewayCallsAfterFirstRender);

  await reloadedReportRow.getByRole("link", { name: "alice.eth" }).click();
  await expect(page).toHaveURL(new RegExp(`/profile/${reporterAddress}$`));
  await expect(page.locator(".profile-page-panel")).toContainText("alice.eth");
  await expect(page.locator(".profile-page-panel")).toContainText("420 BUGZ");
  const profileSubmissions = page.locator("section").filter({ hasText: "[ previous submissions ]" });
  await expect(profileSubmissions.locator("thead th")).toHaveText(["date", "title", "target", "author", "details"]);
  await expect(profileSubmissions).toContainText("Live parser exploit");
  await expect(profileSubmissions).toContainText("2d 4h");
});

test("renders stale cached report and BugBundle details when providers rate limit", async ({ page }) => {
  await seedExpiredReportCaches(page);
  await mockEnsRpc(page);

  let baseCalls = 0;
  let gatewayCalls = 0;
  await page.route("https://mainnet.base.org/**", async (route) => {
    baseCalls += 1;
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Too Many Requests" } })
    });
  });
  await page.route("https://ipfs.io/ipfs/bafyrecentbug", async (route) => {
    gatewayCalls += 1;
    await route.fulfill({
      status: 429,
      contentType: "text/plain",
      body: "Too Many Requests"
    });
  });

  await page.goto("/");

  const recentReports = page.locator("section").filter({ hasText: "[ recent reports ]" });
  const reportRow = recentReports.getByRole("row").filter({ hasText: "Live parser exploit" });
  await expect(reportRow.locator("td").nth(1)).toContainText("Live parser exploit");
  await expect(reportRow).toContainText("Base protocol parser (protocol)");
  await expect(reportRow.locator("td").nth(4)).toHaveText("2d 4h");
  expect(baseCalls).toBeGreaterThan(0);
  expect(gatewayCalls).toBe(1);
});
