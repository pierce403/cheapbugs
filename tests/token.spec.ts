import { expect, test, type Page, type Route } from "@playwright/test";
import { AbiCoder, Interface, parseEther } from "ethers";

const tokenAddress = "0x60df4a0c9a5050c337010cb29c9694ce4d8fbb07";
const treasuryVaultAddress = "0x4a080668d9848928dc6d48921cbdc4273fe27a9d";
const uniswapV4Quoter = "0x0d5e0f971ed27fbff6c2837bf31316121532048d";
const token = (amount: bigint) => amount * 10n ** 18n;
const abiCoder = AbiCoder.defaultAbiCoder();
const quoterInterface = new Interface([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)"
]);

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

const mockBaseRpc = async (page: Page): Promise<{ quoteCalls: () => number }> => {
  let quoteCount = 0;
  await page.route("https://mainnet.base.org/**", async (route: Route) => {
    const payload = JSON.parse(route.request().postData() || "{}") as RpcRequest | RpcRequest[];
    const requests = Array.isArray(payload) ? payload : [payload];

    const responses = requests.map((request): RpcResponse => {
      switch (request.method) {
        case "eth_chainId":
          return { id: request.id, jsonrpc: "2.0", result: "0x2105" };
        case "net_version":
          return { id: request.id, jsonrpc: "2.0", result: "8453" };
        case "eth_getBalance":
          return { id: request.id, jsonrpc: "2.0", result: "0x0" };
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
                      ? abiCoder.encode(["uint256"], [token(10_000_000n)])
                      : selector === "0x70a08231"
                        ? abiCoder.encode(["uint256"], [token(1_000_000n)])
                        : "0x";
            return { id: request.id, jsonrpc: "2.0", result };
          }

          if (target === treasuryVaultAddress) {
            return { id: request.id, jsonrpc: "2.0", result: "0x" };
          }

          if (target === uniswapV4Quoter) {
            quoteCount += 1;
            return {
              id: request.id,
              jsonrpc: "2.0",
              result: quoterInterface.encodeFunctionResult("quoteExactInputSingle", [parseEther("0.5"), 0n])
            };
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

  return { quoteCalls: () => quoteCount };
};

test("token trade quotes update automatically after the user pauses typing", async ({ page }) => {
  const rpc = await mockBaseRpc(page);

  await page.goto("/token");

  const buyPreview = page.locator("#bugz-buy-preview");
  await expect(page.getByRole("button", { name: "quote" }).first()).toBeEnabled();
  await expect(page.getByRole("button", { name: "buy onchain" })).toBeDisabled();
  await expect(buyPreview).toContainText("quote: 0.01 ETH");

  const callsAfterInitialQuote = rpc.quoteCalls();
  await page.locator("#bugz-buy-form input[name='amount']").fill("0.02");

  await expect(buyPreview).toContainText("quote: 0.02 ETH");
  expect(rpc.quoteCalls()).toBeGreaterThan(callsAfterInitialQuote);
});
