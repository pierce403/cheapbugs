import { expect, test, type Page, type Route } from "@playwright/test";
import { AbiCoder, Interface, parseEther } from "ethers";

const tokenAddress = "0x60df4a0c9a5050c337010cb29c9694ce4d8fbb07";
const treasuryVaultAddress = "0x4a080668d9848928dc6d48921cbdc4273fe27a9d";
const uniswapV4Quoter = "0x0d5e0f971ed27fbff6c2837bf31316121532048d";
const localIdentity = {
  address: "0x47e727b6fd24efd9cc74eb5d9153e94c82681d3c",
  privateKey: "0x59c6995e998f97a5a0044966f0945383e9dade06e38b2b0b020a74d5cc78a4f3",
  mnemonic: "test test test test test test test test test test test junk",
  derivationPath: "m/44'/60'/0'/0/0",
  createdAt: "2026-05-17T00:00:00.000Z"
};
const token = (amount: bigint) => amount * 10n ** 18n;
const quantity = (value: bigint | number): string => `0x${BigInt(value).toString(16)}`;
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

const seedLocalIdentity = async (page: Page): Promise<void> => {
  await page.addInitScript((identity) => {
    window.localStorage.setItem("cheapbugs.localXmtpIdentity.v1", JSON.stringify(identity));
  }, localIdentity);
};

const receiptHash = "0x1111111111111111111111111111111111111111111111111111111111111111";

const mockBaseRpc = async (
  page: Page,
  options: { holdRawTransactions?: boolean; nativeBalance?: bigint } = {}
): Promise<{ quoteCalls: () => number; releaseTransactions: () => void }> => {
  let quoteCount = 0;
  let releaseTransactions: () => void = () => {};
  const rawTransactionGate = new Promise<void>((resolve) => {
    releaseTransactions = resolve;
  });

  await page.route("https://mainnet.base.org/**", async (route: Route) => {
    const payload = JSON.parse(route.request().postData() || "{}") as RpcRequest | RpcRequest[];
    const requests = Array.isArray(payload) ? payload : [payload];

    const responses = await Promise.all(requests.map(async (request): Promise<RpcResponse> => {
      switch (request.method) {
        case "eth_chainId":
          return { id: request.id, jsonrpc: "2.0", result: "0x2105" };
        case "net_version":
          return { id: request.id, jsonrpc: "2.0", result: "8453" };
        case "eth_getBalance":
          return { id: request.id, jsonrpc: "2.0", result: quantity(options.nativeBalance ?? parseEther("10")) };
        case "eth_getTransactionCount":
          return { id: request.id, jsonrpc: "2.0", result: "0x1" };
        case "eth_blockNumber":
          return { id: request.id, jsonrpc: "2.0", result: "0x2" };
        case "eth_gasPrice":
        case "eth_maxPriorityFeePerGas":
          return { id: request.id, jsonrpc: "2.0", result: quantity(1_000_000_000n) };
        case "eth_estimateGas":
          return { id: request.id, jsonrpc: "2.0", result: "0x100000" };
        case "eth_getBlockByNumber":
          return {
            id: request.id,
            jsonrpc: "2.0",
            result: {
              number: "0x2",
              hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
              parentHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
              timestamp: quantity(Math.floor(Date.now() / 1000)),
              nonce: "0x0000000000000000",
              difficulty: "0x0",
              gasLimit: "0x1c9c380",
              gasUsed: "0x0",
              miner: "0x0000000000000000000000000000000000000000",
              extraData: "0x",
              transactions: [],
              baseFeePerGas: quantity(1_000_000_000n)
            }
          };
        case "eth_sendRawTransaction":
          if (options.holdRawTransactions) {
            await rawTransactionGate;
          }
          return { id: request.id, jsonrpc: "2.0", result: receiptHash };
        case "eth_getTransactionReceipt":
          return {
            id: request.id,
            jsonrpc: "2.0",
            result: {
              transactionHash: receiptHash,
              blockHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
              blockNumber: "0x2",
              status: "0x1",
              from: localIdentity.address,
              to: "0xfdf682f51fe81aa4898f0ae2163d8a55c127fbc7",
              cumulativeGasUsed: "0x5208",
              gasUsed: "0x5208",
              effectiveGasPrice: quantity(1_000_000_000n),
              contractAddress: null,
              logs: [],
              logsBloom: `0x${"0".repeat(512)}`,
              type: "0x2"
            }
          };
        case "eth_getTransactionByHash":
          return {
            id: request.id,
            jsonrpc: "2.0",
            result: {
              hash: receiptHash,
              blockHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
              blockNumber: "0x2",
              from: localIdentity.address,
              to: "0xfdf682f51fe81aa4898f0ae2163d8a55c127fbc7",
              nonce: "0x1",
              gas: "0x100000",
              gasPrice: quantity(1_000_000_000n),
              value: "0x0",
              input: "0x",
              type: "0x2",
              chainId: "0x2105"
            }
          };
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
    }));

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(Array.isArray(payload) ? responses : responses[0])
    });
  });

  return { quoteCalls: () => quoteCount, releaseTransactions };
};

test("token page puts easy buy before advanced Clanker trading", async ({ page }) => {
  await mockBaseRpc(page);

  await page.goto("/token");

  await expect(page.locator("#easy-buy")).toBeVisible();
  const sectionTitles = (await page.locator("section > .panel-title").allTextContents()).map((title) => title.trim());
  expect(sectionTitles.indexOf("[ bugz ]")).toBeLessThan(sectionTitles.indexOf("[ buy bugz ]"));
  expect(sectionTitles.indexOf("[ buy bugz ]")).toBeLessThan(sectionTitles.indexOf("[ advanced clanker trading ]"));

  await expect(page.locator("section").filter({ hasText: "[ bugz ]" })).toContainText("your Base ETH");
  await expect(page.locator("section").filter({ hasText: "[ bugz ]" })).toContainText("gas target");
  await expect(page.locator("#easy-buy")).toContainText("Easy mode: fund your wallet or buy BUGZ through thirdweb.");
  await expect(page.locator("#easy-buy")).toContainText("If routing is unavailable");
  await expect(page.getByRole("button", { name: "easy buy BUGZ" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "add Base ETH" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "check thirdweb route" })).toBeEnabled();

  const advanced = page.locator("#advanced-clanker-trading");
  await expect(advanced).toContainText("direct Clanker / Uniswap v4 market");
  await expect(advanced).toContainText("Universal Router 2.1.1");
  await expect(advanced.getByRole("button", { name: "buy onchain" })).toBeDisabled();
  await expect(advanced.getByRole("button", { name: "sell onchain" })).toBeDisabled();
});

test("token page shows a non-blocking Base ETH gas helper", async ({ page }) => {
  await seedLocalIdentity(page);
  await mockBaseRpc(page, { nativeBalance: parseEther("0.0001") });

  await page.goto("/token");

  await expect(page.locator(".gas-helper-warning")).toContainText("You need a little ETH on Base for transaction fees.");
  await expect(page.locator("#easy-buy")).toContainText("0.0005 ETH");
  await expect(page.getByRole("button", { name: "add Base ETH" })).toBeEnabled();
  await expect(page.locator("#advanced-clanker-trading").getByRole("button", { name: "buy onchain" })).toBeEnabled();
  await expect(page.locator("#advanced-clanker-trading").getByRole("button", { name: "sell onchain" })).toBeEnabled();
});

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

test("token trades show a cancelable wallet request modal", async ({ page }) => {
  await seedLocalIdentity(page);
  const rpc = await mockBaseRpc(page, { holdRawTransactions: true });

  await page.goto("/token");

  const buyPreview = page.locator("#bugz-buy-preview");
  await expect(page.getByRole("button", { name: "buy onchain" })).toBeEnabled();
  await expect(buyPreview).toContainText("quote: 0.01 ETH");

  await page.getByRole("button", { name: "buy onchain" }).click();
  const modal = page.getByRole("dialog", { name: "wallet request" });
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("buy bugz");
  await expect(modal).toContainText("Approve the buy transaction in your wallet.");

  await modal.getByRole("button", { name: "cancel" }).click();
  await expect(modal).toBeHidden();
  await expect(buyPreview).toContainText("Wallet request cancelled.");

  rpc.releaseTransactions();
});
