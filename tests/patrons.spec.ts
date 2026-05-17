import { expect, test, type Page, type Route } from "@playwright/test";
import { AbiCoder } from "ethers";

const bugzTokenAddress = "0x60df4a0c9a5050c337010cb29c9694ce4d8fbb07";
const deploymentBlock = 46_093_316;
const holderAddress = "0x1111111111111111111111111111111111111111";
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const abiCoder = AbiCoder.defaultAbiCoder();

type RpcRequest = {
  id: number | string | null;
  jsonrpc: "2.0";
  method: string;
  params?: unknown[];
};

type RpcResponse =
  | {
      id: number | string | null;
      jsonrpc: "2.0";
      result: unknown;
    }
  | {
      id: number | string | null;
      jsonrpc: "2.0";
      error: {
        code: number;
        message: string;
      };
    };

const hex = (value: number | bigint): string => `0x${value.toString(16)}`;

const addressTopic = (address: string): string => `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;

const transferLog = () => ({
  address: bugzTokenAddress,
  blockHash: `0x${"1".repeat(64)}`,
  blockNumber: hex(deploymentBlock),
  data: abiCoder.encode(["uint256"], [10_000n * 10n ** 18n]),
  logIndex: "0x0",
  removed: false,
  topics: [transferTopic, addressTopic("0x0000000000000000000000000000000000000000"), addressTopic(holderAddress)],
  transactionHash: `0x${"2".repeat(64)}`,
  transactionIndex: "0x0"
});

const mockEnsRpc = async (page: Page): Promise<void> => {
  await page.route("https://ethereum-rpc.publicnode.com/**", async (route) => {
    const payload = JSON.parse(route.request().postData() || "{}") as RpcRequest | RpcRequest[];
    const requests = Array.isArray(payload) ? payload : [payload];
    const responses = requests.map((request): RpcResponse => ({
      id: request.id,
      jsonrpc: "2.0",
      result: request.method === "eth_chainId" ? "0x1" : "0x"
    }));

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(Array.isArray(payload) ? responses : responses[0])
    });
  });
};

const mockBaseRpc = async (
  page: Page,
  options: {
    latestBlock: number;
    rejectLogs?: boolean;
    ranges?: Array<{ fromBlock: number; toBlock: number }>;
  }
): Promise<void> => {
  await page.route("https://mainnet.base.org/**", async (route: Route) => {
    const payload = JSON.parse(route.request().postData() || "{}") as RpcRequest | RpcRequest[];
    const requests = Array.isArray(payload) ? payload : [payload];

    const responses = requests.map((request): RpcResponse => {
      switch (request.method) {
        case "eth_chainId":
          return { id: request.id, jsonrpc: "2.0", result: "0x2105" };
        case "net_version":
          return { id: request.id, jsonrpc: "2.0", result: "8453" };
        case "eth_blockNumber":
          return { id: request.id, jsonrpc: "2.0", result: hex(options.latestBlock) };
        case "eth_call": {
          const call = (request.params?.[0] ?? {}) as { data?: string };
          const selector = call.data?.slice(0, 10).toLowerCase();
          const result =
            selector === "0x06fdde03"
              ? abiCoder.encode(["string"], ["CheapBugs"])
              : selector === "0x95d89b41"
                ? abiCoder.encode(["string"], ["BUGZ"])
                : selector === "0x313ce567"
                  ? abiCoder.encode(["uint8"], [18])
                  : selector === "0x18160ddd"
                    ? abiCoder.encode(["uint256"], [10_000_000n * 10n ** 18n])
                    : "0x";
          return { id: request.id, jsonrpc: "2.0", result };
        }
        case "eth_getLogs": {
          const filter = (request.params?.[0] ?? {}) as { fromBlock: string; toBlock: string };
          const fromBlock = Number(BigInt(filter.fromBlock));
          const toBlock = Number(BigInt(filter.toBlock));
          options.ranges?.push({ fromBlock, toBlock });

          if (options.rejectLogs) {
            return {
              id: request.id,
              jsonrpc: "2.0",
              error: {
                code: -32614,
                message: "eth_getLogs is limited to a 10,000 range"
              }
            };
          }

          return {
            id: request.id,
            jsonrpc: "2.0",
            result: fromBlock <= deploymentBlock && deploymentBlock <= toBlock ? [transferLog()] : []
          };
        }
        default:
          return { id: request.id, jsonrpc: "2.0", result: "0x" };
      }
    });

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(Array.isArray(payload) ? responses : responses[0])
    });
  });
};

test.beforeEach(async ({ page }) => {
  await mockEnsRpc(page);
});

test("patrons scans Transfer logs in RPC-safe pages and caches the result", async ({ page }) => {
  const ranges: Array<{ fromBlock: number; toBlock: number }> = [];
  await mockBaseRpc(page, { latestBlock: deploymentBlock + 15_000, ranges });

  await page.goto("/patrons");

  await expect(page.getByText("[ patrons leaderboard ]")).toBeVisible();
  await expect(page.getByText("Base Transfer log scan")).toBeVisible();
  await expect(page.getByText("10,000 BUGZ")).toBeVisible();
  await expect(page.getByRole("link", { name: "basescan holders" })).toHaveAttribute(
    "href",
    /basescan\.org\/token\/0x60Df4a0C9A5050c337010cb29C9694cE4d8fbb07#balances/i
  );

  expect(ranges.length).toBeGreaterThan(1);
  for (const range of ranges) {
    expect(range.toBlock - range.fromBlock + 1).toBeLessThanOrEqual(10_000);
  }

  const callsBeforeReload = ranges.length;
  await page.reload();
  await expect(page.getByText("10,000 BUGZ")).toBeVisible();
  expect(ranges.length).toBe(callsBeforeReload);

  await page.getByRole("button", { name: "refresh holders" }).click();
  await expect(page.getByText("Refreshing BUGZ holder cache.")).toBeVisible();
  await expect.poll(() => ranges.length).toBeGreaterThan(callsBeforeReload);
});

test("patrons explains holder API key setup when the RPC rejects log scans", async ({ page }) => {
  await mockBaseRpc(page, { latestBlock: deploymentBlock + 1, rejectLogs: true });

  await page.goto("/patrons");

  await expect(page.getByText("The configured Base RPC rejected the BUGZ holder scan")).toBeVisible();
  await expect(page.getByText("could not coalesce error")).toHaveCount(0);
  await expect(page.getByText("eth_getLogs is limited")).toHaveCount(0);
  await expect(page.getByText("VITE_ETHERSCAN_API_KEY", { exact: true })).toBeVisible();
  await expect(page.getByText("VITE_BASESCAN_API_KEY", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Etherscan API Dashboard" })).toHaveAttribute(
    "href",
    "https://etherscan.io/myapikey"
  );
  await expect(page.getByRole("link", { name: "tokenholderlist" })).toHaveAttribute(
    "href",
    "https://docs.etherscan.io/api-reference/endpoint/tokenholderlist"
  );
});
