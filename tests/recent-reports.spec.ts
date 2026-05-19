import { expect, test, type Page, type Route } from "@playwright/test";
import { AbiCoder, Interface, id } from "ethers";

import { bugIndexAbi } from "../src/contracts/bugIndexAbi";

const bugIndexAddress = "0x515FDbc9876aC26870794E26605c7DD04c18679b";
const bondVaultAddress = "0x2Eab99B6d6F1FBDa4fa78a00662E0cf9aBd9f3d3";
const treasuryVaultAddress = "0x4A080668d9848928dc6D48921cbDc4273fe27A9d";
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
    createdAt + 604_800n,
    zeroBytes32,
    false,
    0,
    false,
    0n,
    0
  ];
};

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

const mockBugBundleGateway = async (page: Page): Promise<void> => {
  await page.route("https://ipfs.io/ipfs/bafyrecentbug", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
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
      })
    });
  });
};

test("renders newly indexed onchain bugs in recent reports", async ({ page }) => {
  const { counts } = await mockBaseRpc(page);
  await mockEnsRpc(page);
  await mockBugBundleGateway(page);

  await page.goto("/");

  await expect(page.getByText(`bug index: ${bugIndexAddress}`)).toBeVisible();
  await expect(page.getByText(`bond vault: ${bondVaultAddress}`)).toBeVisible();
  await expect(page.getByText(`treasury vault: ${treasuryVaultAddress}`)).toBeVisible();

  const recentReports = page.locator("section").filter({ hasText: "[ recent reports ]" });
  const reportRow = recentReports.getByRole("row").filter({ hasText: "Live parser exploit" });
  await expect(reportRow).toContainText("Fresh broker-published bug from chain.");
  await expect(reportRow).toContainText("Base protocol parser (protocol)");
  await expect(reportRow).toContainText("alice.eth");
  await expect(reportRow.getByRole("link", { name: "bundle" })).toHaveAttribute(
    "href",
    "https://ipfs.io/ipfs/bafyrecentbug"
  );
  await expect(recentReports.getByText("No onchain bug reports resolved yet.")).toHaveCount(0);

  expect(counts.latest).toBeGreaterThan(0);
  expect(counts.getReport).toBeGreaterThan(0);

  const countsAfterFirstRender = { ...counts };
  await page.getByRole("link", { name: "submit" }).click();
  await expect(page).toHaveURL(/\/submit$/);
  await page.getByRole("link", { name: "index" }).click();
  await expect(reportRow).toContainText("Fresh broker-published bug from chain.");
  expect(counts).toEqual(countsAfterFirstRender);

  await reportRow.getByRole("link", { name: "alice.eth" }).click();
  await expect(page).toHaveURL(new RegExp(`/profile/${reporterAddress}$`));
  await expect(page.locator(".profile-page-panel")).toContainText("alice.eth");
  await expect(page.locator(".profile-page-panel")).toContainText("420 BUGZ");
  const profileSubmissions = page.locator("section").filter({ hasText: "[ previous submissions ]" });
  await expect(profileSubmissions).toContainText("Live parser exploit");
});
