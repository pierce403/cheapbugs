import { expect, test, type Page, type Route } from "@playwright/test";
import { AbiCoder, Interface, parseEther } from "ethers";

const tokenAddress = "0x60df4a0c9a5050c337010cb29c9694ce4d8fbb07";
const treasuryVaultAddress = "0x4a080668d9848928dc6d48921cbdc4273fe27a9d";
const chainlinkEthUsdFeed = "0x71041dddad3595f9ced3dccfbe3d1f4b0a16bb70";
const uniswapV4Quoter = "0x0d5e0f971ed27fbff6c2837bf31316121532048d";
const token = (amount: bigint) => amount * 10n ** 18n;
const abiCoder = AbiCoder.defaultAbiCoder();
const treasuryInterface = new Interface([
  "function standardPayoutDivisor() view returns (uint256)",
  "function calculateRewardAmount(uint8 multiplier) view returns (uint256)"
]);
const feedInterface = new Interface([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)"
]);
const quoterInterface = new Interface([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)"
]);

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

const dexScreenerPairs = (priceUsd = "1.5") => [
  {
    chainId: "base",
    dexId: "uniswap",
    url: "https://dexscreener.com/base/bugz-weth",
    pairAddress: "0x1111111111111111111111111111111111111111",
    baseToken: {
      address: tokenAddress,
      name: "CheapBugs",
      symbol: "BUGZ"
    },
    quoteToken: {
      address: "0x4200000000000000000000000000000000000006",
      name: "Wrapped Ether",
      symbol: "WETH"
    },
    priceUsd,
    liquidity: {
      usd: 100_000
    }
  }
];

const mockDexScreener = async (
  page: Page,
  options: { rejectDexScreener?: boolean; priceUsd?: string; counts?: { requests: number } } = {}
): Promise<void> => {
  await page.route("https://api.dexscreener.com/**", async (route: Route) => {
    if (options.counts) {
      options.counts.requests += 1;
    }
    if (options.rejectDexScreener) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "price unavailable" })
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(dexScreenerPairs(options.priceUsd))
    });
  });
};

const mockBaseRpc = async (page: Page, options: { rejectQuote?: boolean } = {}): Promise<void> => {
  await page.route("https://mainnet.base.org/**", async (route: Route) => {
    const payload = JSON.parse(route.request().postData() || "{}") as RpcRequest | RpcRequest[];
    const requests = Array.isArray(payload) ? payload : [payload];

    const responses = requests.map((request): RpcResponse => {
      switch (request.method) {
        case "eth_chainId":
          return { id: request.id, jsonrpc: "2.0", result: "0x2105" };
        case "net_version":
          return { id: request.id, jsonrpc: "2.0", result: "8453" };
        case "eth_call": {
          const call = (request.params?.[0] ?? {}) as { to?: string; data?: string };
          const target = call.to?.toLowerCase();
          const selector = call.data?.slice(0, 10).toLowerCase();

          if (target === tokenAddress) {
            const result =
              selector === "0x06fdde03"
                ? abiCoder.encode(["string"], ["CheapBugs"])
                : selector === "0x95d89b41"
                  ? abiCoder.encode(["string"], ["BUGZ"])
                  : selector === "0x313ce567"
                    ? abiCoder.encode(["uint8"], [18])
                    : selector === "0x18160ddd"
                      ? abiCoder.encode(["uint256"], [10_000_000n * 10n ** 18n])
                      : selector === "0x70a08231"
                        ? abiCoder.encode(["uint256"], [token(1_000_000n)])
                        : "0x";
            return { id: request.id, jsonrpc: "2.0", result };
          }

          if (target === treasuryVaultAddress) {
            if (selector === treasuryInterface.getFunction("standardPayoutDivisor")?.selector) {
              return {
                id: request.id,
                jsonrpc: "2.0",
                result: treasuryInterface.encodeFunctionResult("standardPayoutDivisor", [1_000n])
              };
            }

            if (selector === treasuryInterface.getFunction("calculateRewardAmount")?.selector) {
              const [multiplier] = treasuryInterface.decodeFunctionData("calculateRewardAmount", call.data ?? "0x") as [
                bigint
              ];
              return {
                id: request.id,
                jsonrpc: "2.0",
                result: treasuryInterface.encodeFunctionResult("calculateRewardAmount", [token(1_000n * multiplier)])
              };
            }
          }

          if (target === uniswapV4Quoter) {
            if (options.rejectQuote) {
              return {
                id: request.id,
                jsonrpc: "2.0",
                error: { code: 429, message: "Too Many Requests" }
              };
            }

            return {
              id: request.id,
              jsonrpc: "2.0",
              result: quoterInterface.encodeFunctionResult("quoteExactInputSingle", [parseEther("0.5"), 0n])
            };
          }

          if (target === chainlinkEthUsdFeed) {
            const result =
              selector === feedInterface.getFunction("decimals")?.selector
                ? feedInterface.encodeFunctionResult("decimals", [8])
                : selector === feedInterface.getFunction("latestRoundData")?.selector
                  ? feedInterface.encodeFunctionResult("latestRoundData", [
                      1n,
                      3_000n * 100_000_000n,
                      0n,
                      1_779_494_400n,
                      1n
                    ])
                  : "0x";
            return { id: request.id, jsonrpc: "2.0", result };
          }

          return { id: request.id, jsonrpc: "2.0", result: "0x" };
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

test("treasury shows BUGZ value and USD payout range", async ({ page }) => {
  await mockDexScreener(page);
  await mockBaseRpc(page);

  await page.goto("/treasury");

  const panel = page.getByTestId("treasury-panel");
  await expect(page.getByRole("link", { name: "treasury" })).toBeVisible();
  await expect(panel).toContainText("Send BUGZ to the treasury vault");
  await expect(page.getByTestId("treasury-value")).toContainText("1,000,000 BUGZ");
  await expect(page.getByTestId("treasury-value")).toContainText("$1,500,000.00");
  await expect(page.getByTestId("treasury-payout-range")).toContainText("1,000 BUGZ - 10,000 BUGZ");
  await expect(page.getByTestId("treasury-payout-range")).toContainText("$1,500.00 - $15,000.00");
  await expect(panel).toContainText("0.1% - 1%");
  await expect(panel).toContainText("Dex Screener BUGZ/USD token-pairs API");
  await expect(page.getByRole("button", { name: "copy treasury address" })).toBeEnabled();
});

test("treasury falls back to onchain pricing when Dex Screener is unavailable", async ({ page }) => {
  await mockDexScreener(page, { rejectDexScreener: true });
  await mockBaseRpc(page);

  await page.goto("/treasury");

  const panel = page.getByTestId("treasury-panel");
  await expect(page.getByTestId("treasury-value")).toContainText("$1,500,000.00");
  await expect(page.getByTestId("treasury-payout-range")).toContainText("$1,500.00 - $15,000.00");
  await expect(panel).toContainText("Uniswap v4 BUGZ/WETH quote plus Chainlink ETH/USD");
});

test("treasury caches BUGZ price for ten minutes", async ({ page }) => {
  const counts = { requests: 0 };
  await mockDexScreener(page, { counts });
  await mockBaseRpc(page);

  await page.goto("/treasury");
  await expect(page.getByTestId("treasury-value")).toContainText("$1,500,000.00");
  expect(counts.requests).toBe(1);

  await page.reload();
  await expect(page.getByTestId("treasury-value")).toContainText("$1,500,000.00");
  expect(counts.requests).toBe(1);
});

test("treasury keeps BUGZ amounts visible when USD pricing is unavailable", async ({ page }) => {
  await mockDexScreener(page, { rejectDexScreener: true });
  await mockBaseRpc(page, { rejectQuote: true });

  await page.goto("/treasury");

  const panel = page.getByTestId("treasury-panel");
  await expect(page.getByTestId("treasury-value")).toContainText("1,000,000 BUGZ");
  await expect(page.getByTestId("treasury-payout-range")).toContainText("1,000 BUGZ - 10,000 BUGZ");
  await expect(panel).toContainText("BUGZ/USD price read failed");
});
