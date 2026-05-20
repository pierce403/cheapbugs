import { expect, test, type Page, type Route } from "@playwright/test";
import { Interface, id, AbiCoder } from "ethers";

import { bugIndexAbi } from "../src/contracts/bugIndexAbi";

const bugIndexAddress = "0x515FDbc9876aC26870794E26605c7DD04c18679b";
const bondVaultAddress = "0x2Eab99B6d6F1FBDa4fa78a00662E0cf9aBd9f3d3";
const treasuryVaultAddress = "0x4A080668d9848928dc6D48921cbDc4273fe27A9d";
const reporterAddress = "0x1234567890123456789012345678901234567890";
const reviewerAddress = "0x47e727b6fd24efd9cc74eb5d9153e94c82681d3c";
const reportHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const reviewSchemaUid = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const zeroBytes32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const zeroAddress = "0x0000000000000000000000000000000000000000";
const bugIndexInterface = new Interface(bugIndexAbi);
const abiCoder = AbiCoder.defaultAbiCoder();
const getReportSelector = bugIndexInterface.getFunction("getReport")?.selector;
const reverseSelector = id("reverseWithGateways(bytes,uint256,string[])").slice(0, 10);
const resolveSelector = id("resolveWithGateways(bytes,bytes,string[])").slice(0, 10);

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

const reportTuple = () => [
  reportHash,
  "CB-LIVE-0001",
  reporterAddress,
  1_779_120_000n,
  2,
  "Fresh broker-published bug from chain.",
  "ipfs://bafyreportdetail",
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

const seedReviewSchema = async (page: Page): Promise<void> => {
  await page.addInitScript((schemaUid) => {
    window.localStorage.setItem("cheapbugs.cache:schema-uids", JSON.stringify({ ReviewVerdict: schemaUid }));
  }, reviewSchemaUid);
};

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
      if (request.method === "eth_call") {
        const call = (request.params?.[0] ?? {}) as { data?: string; to?: string };
        const selector = call.data?.slice(0, 10).toLowerCase();
        const target = call.to?.toLowerCase();
        if (target === bugIndexAddress.toLowerCase() && selector === getReportSelector) {
          return {
            id: request.id,
            jsonrpc: "2.0",
            result: bugIndexInterface.encodeFunctionResult("getReport", [reportTuple()])
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
  await page.route("https://ipfs.io/ipfs/bafyreportdetail", async (route) => {
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

const mockEasGraphql = async (page: Page): Promise<void> => {
  await page.route("https://base.easscan.org/graphql", async (route) => {
    const request = JSON.parse(route.request().postData() || "{}") as {
      variables?: { schemaId?: string; needle?: string };
    };
    expect(request.variables?.schemaId).toBe(reviewSchemaUid);
    expect(request.variables?.needle).toBe(reportHash);

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          attestations: [
            {
              id: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
              decodedDataJson: JSON.stringify([
                { name: "reportHash", type: "bytes32", value: { value: reportHash } },
                { name: "validity", type: "uint8", value: { value: 0 } },
                { name: "impact", type: "uint8", value: { value: 3 } },
                { name: "rewardClass", type: "uint8", value: { value: 2 } },
                { name: "confidence", type: "uint8", value: { value: 92 } },
                { name: "noteCID", type: "string", value: { value: "ipfs://bafyreviewnote" } }
              ]),
              attester: reviewerAddress,
              recipient: zeroAddress,
              time: 1_779_200_000,
              timeCreated: 1_779_200_000,
              refUID: zeroBytes32,
              revoked: false,
              txid: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
              schemaId: reviewSchemaUid
            }
          ]
        }
      })
    });
  });
};

test("report detail hides contract addresses and renders EAS review rows", async ({ page }) => {
  await seedReviewSchema(page);
  await mockBaseRpc(page);
  await mockEnsRpc(page);
  await mockBugBundleGateway(page);
  await mockEasGraphql(page);

  await page.goto(`/report/${reportHash}`);

  const reportSection = page.locator("section").filter({ hasText: "[ Live parser exploit ]" });
  await expect(reportSection).toContainText("Live parser exploit");
  await expect(reportSection).toContainText("alice.eth");
  await expect(reportSection).not.toContainText("bug index");
  await expect(reportSection).not.toContainText("bond vault");
  await expect(reportSection).not.toContainText("treasury vault");
  await expect(page.getByText(bugIndexAddress)).toHaveCount(0);
  await expect(page.getByText(bondVaultAddress)).toHaveCount(0);
  await expect(page.getByText(treasuryVaultAddress)).toHaveCount(0);

  const reviewSection = page.locator("section").filter({ hasText: "[ trusted review state ]" });
  await expect(reviewSection.locator("thead th")).toHaveText([
    "reviewer",
    "trust",
    "validity",
    "impact",
    "reward",
    "confidence",
    "note"
  ]);
  await expect(reviewSection).toContainText("headline: confirmed / high / paid / confidence 92");
  const reviewRow = reviewSection.getByRole("row").filter({ hasText: "confirmed" });
  await expect(reviewRow).toContainText("trusted");
  await expect(reviewRow).toContainText("high");
  await expect(reviewRow).toContainText("paid");
  await expect(reviewRow).toContainText("92");

  await expect(page.getByText("[ private details ]")).toBeVisible();
  await expect(page.getByRole("button", { name: "unlock details" })).toBeVisible();
  await expect(page.getByRole("button", { name: "unlock dossier" })).toHaveCount(0);
});
