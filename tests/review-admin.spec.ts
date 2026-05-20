import { expect, test, type Page, type Route } from "@playwright/test";
import { AbiCoder, Interface, id } from "ethers";

import { bugIndexAbi } from "../src/contracts/bugIndexAbi";

const bugIndexAddress = "0x515FDbc9876aC26870794E26605c7DD04c18679b";
const bugzTokenAddress = "0x60Df4a0C9A5050c337010cb29C9694cE4d8fbb07";
const adminAddress = "0x47e727b6fd24efd9cc74eb5d9153e94c82681d3c";
const otherOwnerAddress = "0x1234567890123456789012345678901234567890";
const reporterAddress = "0x9999999999999999999999999999999999999999";
const reportHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const zeroBytes32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const abiCoder = AbiCoder.defaultAbiCoder();
const ownableInterface = new Interface(["function owner() view returns (address)"]);
const tokenInterface = new Interface(["function balanceOf(address account) view returns (uint256)"]);
const bugIndexInterface = new Interface(bugIndexAbi);
const latestReportHashesSelector = bugIndexInterface.getFunction("latestReportHashes")?.selector;
const getReportSelector = bugIndexInterface.getFunction("getReport")?.selector;
const adminsSelector = bugIndexInterface.getFunction("admins")?.selector;
const reverseSelector = id("reverseWithGateways(bytes,uint256,string[])").slice(0, 10);
const resolveSelector = id("resolveWithGateways(bytes,bytes,string[])").slice(0, 10);
const zeroAddress = "0x0000000000000000000000000000000000000000";
const localIdentity = {
  address: adminAddress,
  privateKey: "0x59c6995e998f97a5a0044966f0945383e9dade06e38b2b0b020a74d5cc78a4f3",
  mnemonic: "test test test test test test test test test test test junk",
  derivationPath: "m/44'/60'/0'/0/0",
  createdAt: "2026-05-17T00:00:00.000Z"
};

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

const seedLocalIdentity = async (page: Page): Promise<void> => {
  await page.addInitScript((identity) => {
    window.localStorage.setItem("cheapbugs.localXmtpIdentity.v1", JSON.stringify(identity));
  }, localIdentity);
};

const reportTuple = () => [
  reportHash,
  "CB-ADMIN-0001",
  reporterAddress,
  1_779_120_000n,
  2,
  "Fresh broker-published bug ready for admin triage.",
  "ipfs://bafyreviewadmin",
  4,
  id("base-protocol"),
  "base, parser",
  id("public-content"),
  id("bug-bundle"),
  id("encrypted-details"),
  id("details-key"),
  BigInt(Math.floor(Date.now() / 1000) + 604_800),
  zeroBytes32,
  false,
  0,
  false,
  0n,
  0
];

const mockBaseRpc = async (page: Page): Promise<void> => {
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
      if (request.method !== "eth_call") {
        return { id: request.id, jsonrpc: "2.0", result: "0x" };
      }

      const call = (request.params?.[0] ?? {}) as { data?: string; to?: string };
      const selector = call.data?.slice(0, 10).toLowerCase();
      const target = call.to?.toLowerCase();

      if (selector === ownableInterface.getFunction("owner")?.selector) {
        return {
          id: request.id,
          jsonrpc: "2.0",
          result: ownableInterface.encodeFunctionResult("owner", [otherOwnerAddress])
        };
      }

      if (target === bugzTokenAddress.toLowerCase() && selector === tokenInterface.getFunction("balanceOf")?.selector) {
        return {
          id: request.id,
          jsonrpc: "2.0",
          result: tokenInterface.encodeFunctionResult("balanceOf", [420n * 10n ** 18n])
        };
      }

      if (target === bugIndexAddress.toLowerCase() && selector === adminsSelector) {
        return {
          id: request.id,
          jsonrpc: "2.0",
          result: bugIndexInterface.encodeFunctionResult("admins", [true])
        };
      }

      if (target === bugIndexAddress.toLowerCase() && selector === latestReportHashesSelector) {
        return {
          id: request.id,
          jsonrpc: "2.0",
          result: bugIndexInterface.encodeFunctionResult("latestReportHashes", [[reportHash]])
        };
      }

      if (target === bugIndexAddress.toLowerCase() && selector === getReportSelector) {
        return {
          id: request.id,
          jsonrpc: "2.0",
          result: bugIndexInterface.encodeFunctionResult("getReport", [reportTuple()])
        };
      }

      return {
        id: request.id,
        jsonrpc: "2.0",
        result: abiCoder.encode(["uint256"], [0n])
      };
    });

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(Array.isArray(payload) ? responses : responses[0])
    });
  });
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
            result: abiCoder.encode(["string", "address", "address"], ["", zeroAddress, zeroAddress])
          };
        }
        if (selector === resolveSelector) {
          return {
            id: request.id,
            jsonrpc: "2.0",
            result: abiCoder.encode(["bytes", "address"], [abiCoder.encode(["string"], [""]), zeroAddress])
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
  await page.route("https://ipfs.io/ipfs/bafyreviewadmin", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        schema: "cheapbugs.bug_bundle.v1",
        version: 1,
        core: {
          submission: {
            title: "Admin-visible parser exploit",
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

const mockEasGraphql = async (page: Page): Promise<void> => {
  await page.route("https://base.easscan.org/graphql", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: { attestations: [] } })
    });
  });
};

test("shows review queue and status flag controls for onchain index admins", async ({ page }) => {
  await seedLocalIdentity(page);
  await mockBaseRpc(page);
  await mockEnsRpc(page);
  await mockBugBundleGateway(page);
  await mockEasGraphql(page);

  await page.goto("/review");

  await expect(page.getByRole("link", { name: "manage", exact: true })).toHaveCount(0);
  const queue = page.locator("section").filter({ hasText: "[ reviewer queue ]" });
  await expect(queue).toContainText("Index admin access recognized");
  await expect(queue).toContainText("Admin-visible parser exploit");
  await expect(queue).toContainText("unreviewed");
  await expect(queue.getByLabel("admin status for Admin-visible parser exploit")).toBeVisible();
  await expect(queue.getByRole("button", { name: "flag" })).toBeVisible();
});
