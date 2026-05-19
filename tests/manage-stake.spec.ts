import { expect, test, type Page } from "@playwright/test";
import { AbiCoder, Interface } from "ethers";

const bugIndexAddress = "0x515FDbc9876aC26870794E26605c7DD04c18679b";
const bondVaultAddress = "0x2Eab99B6d6F1FBDa4fa78a00662E0cf9aBd9f3d3";
const treasuryVaultAddress = "0x4A080668d9848928dc6D48921cbDc4273fe27A9d";
const bugzTokenAddress = "0x60Df4a0C9A5050c337010cb29C9694cE4d8fbb07";
const ownerAddress = "0x47e727b6fd24efd9cc74eb5d9153e94c82681d3c";
const otherOwnerAddress = "0x1234567890123456789012345678901234567890";
const brokerAddress = "0xea6995fc3674e1e94736766f5eeefb0506e4ef32";
const adminAddress = "0x7ab874eeef0169ada0d225e9801a3ffffa26aac3";
const localIdentity = {
  address: ownerAddress,
  privateKey: "0x59c6995e998f97a5a0044966f0945383e9dade06e38b2b0b020a74d5cc78a4f3",
  mnemonic: "test test test test test test test test test test test junk",
  derivationPath: "m/44'/60'/0'/0/0",
  createdAt: "2026-05-17T00:00:00.000Z"
};

const token = (amount: bigint) => amount * 10n ** 18n;
const abiCoder = AbiCoder.defaultAbiCoder();
const ownableInterface = new Interface(["function owner() view returns (address)"]);
const tokenInterface = new Interface([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)"
]);
const bondInterface = new Interface([
  "function owner() view returns (address)",
  "function treasury() view returns (address)",
  "function accountOf(address accountAddress) view returns (tuple(uint256 active,uint256 pendingWithdrawal,uint64 withdrawAvailableAt))",
  "function getLevel(address accountAddress) view returns (uint8)",
  "function WITHDRAWAL_DELAY() view returns (uint256)"
]);
const indexInterface = new Interface([
  "function owner() view returns (address)",
  "function bondVault() view returns (address)",
  "function treasuryVault() view returns (address)",
  "function brokerCount() view returns (uint256)",
  "function brokerAt(uint256 index) view returns (address)",
  "function adminCount() view returns (uint256)",
  "function adminAt(uint256 index) view returns (address)"
]);
const treasuryInterface = new Interface([
  "function owner() view returns (address)",
  "function index() view returns (address)",
  "function standardPayoutDivisor() view returns (uint256)",
  "function brokerCount() view returns (uint256)",
  "function brokerAt(uint256 brokerIndex) view returns (address)"
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

const encodeOwner = (owner: string): string => ownableInterface.encodeFunctionResult("owner", [owner]);

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
  options: { owner: string; withdrawAvailableAt?: number }
): Promise<void> => {
  const withdrawAvailableAt = BigInt(options.withdrawAvailableAt ?? Math.floor(Date.now() / 1000) + 3_700);

  await page.route("https://mainnet.base.org/**", async (route) => {
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
        return { id: request.id, jsonrpc: "2.0", result: encodeOwner(options.owner) };
      }

      if (target === bugzTokenAddress.toLowerCase()) {
        const result =
          selector === tokenInterface.getFunction("name")?.selector
            ? tokenInterface.encodeFunctionResult("name", ["CheapBugs"])
            : selector === tokenInterface.getFunction("symbol")?.selector
              ? tokenInterface.encodeFunctionResult("symbol", ["BUGZ"])
              : selector === tokenInterface.getFunction("decimals")?.selector
                ? tokenInterface.encodeFunctionResult("decimals", [18])
                : selector === tokenInterface.getFunction("totalSupply")?.selector
                  ? tokenInterface.encodeFunctionResult("totalSupply", [token(1_000_000n)])
                  : selector === tokenInterface.getFunction("balanceOf")?.selector
                    ? tokenInterface.encodeFunctionResult("balanceOf", [token(1_500n)])
                    : selector === tokenInterface.getFunction("allowance")?.selector
                      ? tokenInterface.encodeFunctionResult("allowance", [token(25n)])
                      : "0x";
        return { id: request.id, jsonrpc: "2.0", result };
      }

      if (target === bugIndexAddress.toLowerCase()) {
        const result =
          selector === indexInterface.getFunction("bondVault")?.selector
            ? indexInterface.encodeFunctionResult("bondVault", [bondVaultAddress])
            : selector === indexInterface.getFunction("treasuryVault")?.selector
              ? indexInterface.encodeFunctionResult("treasuryVault", [treasuryVaultAddress])
              : selector === indexInterface.getFunction("brokerCount")?.selector
                ? indexInterface.encodeFunctionResult("brokerCount", [1])
                : selector === indexInterface.getFunction("brokerAt")?.selector
                  ? indexInterface.encodeFunctionResult("brokerAt", [brokerAddress])
                  : selector === indexInterface.getFunction("adminCount")?.selector
                    ? indexInterface.encodeFunctionResult("adminCount", [1])
                    : selector === indexInterface.getFunction("adminAt")?.selector
                      ? indexInterface.encodeFunctionResult("adminAt", [adminAddress])
                      : "0x";
        return { id: request.id, jsonrpc: "2.0", result };
      }

      if (target === treasuryVaultAddress.toLowerCase()) {
        const result =
          selector === treasuryInterface.getFunction("index")?.selector
            ? treasuryInterface.encodeFunctionResult("index", [bugIndexAddress])
            : selector === treasuryInterface.getFunction("standardPayoutDivisor")?.selector
              ? treasuryInterface.encodeFunctionResult("standardPayoutDivisor", [1_000n])
              : selector === treasuryInterface.getFunction("brokerCount")?.selector
                ? treasuryInterface.encodeFunctionResult("brokerCount", [1])
                : selector === treasuryInterface.getFunction("brokerAt")?.selector
                  ? treasuryInterface.encodeFunctionResult("brokerAt", [brokerAddress])
                  : "0x";
        return { id: request.id, jsonrpc: "2.0", result };
      }

      if (target === bondVaultAddress.toLowerCase()) {
        const result =
          selector === bondInterface.getFunction("treasury")?.selector
            ? bondInterface.encodeFunctionResult("treasury", [treasuryVaultAddress])
            : selector === bondInterface.getFunction("accountOf")?.selector
              ? bondInterface.encodeFunctionResult("accountOf", [[token(250n), token(50n), withdrawAvailableAt]])
              : selector === bondInterface.getFunction("getLevel")?.selector
                ? bondInterface.encodeFunctionResult("getLevel", [2])
                : selector === bondInterface.getFunction("WITHDRAWAL_DELAY")?.selector
                  ? bondInterface.encodeFunctionResult("WITHDRAWAL_DELAY", [604_800n])
                  : "0x";
        return { id: request.id, jsonrpc: "2.0", result };
      }

      return { id: request.id, jsonrpc: "2.0", result: abiCoder.encode(["uint256"], [0n]) };
    });

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(Array.isArray(payload) ? responses : responses[0])
    });
  });
};

test("shows staking level, allowance, and pending-withdrawal countdown", async ({ page }) => {
  await seedLocalIdentity(page);
  await mockEnsRpc(page);
  await mockBaseRpc(page, { owner: otherOwnerAddress });

  await page.goto("/stake");

  await expect(page.getByRole("link", { name: "stake" })).toBeVisible();
  const stakePanel = page.getByTestId("stake-panel");
  await expect(stakePanel.locator(".stake-level-badge strong")).toHaveText("2");
  await expect(stakePanel).toContainText("250 BUGZ active");
  await expect(stakePanel).toContainText("pending withdrawal");
  await expect(stakePanel).toContainText("50 BUGZ");
  await expect(stakePanel).toContainText("1,500 BUGZ");
  await expect(stakePanel).toContainText("25 BUGZ");
  await expect(page.getByText("step 2: waiting period")).toBeVisible();
  await expect(page.locator("[data-countdown-label]")).not.toHaveText("-");
  await expect(page.getByRole("button", { name: "withdraw pending BUGZ" })).toBeDisabled();
  await expect(page.getByText("Adding a new bond cancels your pending withdrawal")).toBeVisible();
});

test("backs off from stake reads when Base RPC rate-limits", async ({ page }) => {
  await seedLocalIdentity(page);
  await mockEnsRpc(page);
  let baseCalls = 0;
  await page.route("https://mainnet.base.org/**", async (route) => {
    baseCalls += 1;
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      headers: { "retry-after": "60" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: 429, message: "Too Many Requests" }
      })
    });
  });

  await page.goto("/stake");

  const stakePanel = page.getByTestId("stake-panel");
  await expect(stakePanel).toContainText(/rate-limiting|Too Many Requests|Base RPC/i);
  await expect(stakePanel).toContainText("wallet balance");
  expect(baseCalls).toBeLessThanOrEqual(3);
});

test("shows manage navigation and owner-only contract controls for the owner wallet", async ({ page }) => {
  await seedLocalIdentity(page);
  await mockEnsRpc(page);
  await mockBaseRpc(page, { owner: ownerAddress });

  await page.goto("/");
  await expect(page.getByRole("link", { name: "manage", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "manage", exact: true }).click();

  const managePanel = page.getByTestId("manage-panel");
  await expect(managePanel).toContainText("Renounce ownership is intentionally not exposed");
  await expect(managePanel).toContainText("CheapBugsBugIndex");
  await expect(managePanel).toContainText(ownerAddress);
  await expect(page.getByText("update index broker")).toBeVisible();
  await expect(page.getByText("update index admin")).toBeVisible();
  await expect(page.getByText("set index bond vault")).toBeVisible();
  await expect(page.getByText("set payout divisor")).toBeVisible();
  await expect(page.getByText("update bond slasher")).toBeVisible();
  await expect(page.getByText(brokerAddress).first()).toBeVisible();
});

test("blocks direct manage access for non-owner wallets", async ({ page }) => {
  await seedLocalIdentity(page);
  await mockEnsRpc(page);
  await mockBaseRpc(page, { owner: otherOwnerAddress });

  await page.goto("/manage");

  await expect(page.getByTestId("manage-panel")).toContainText("connected wallet is not a contract owner");
  await expect(page.getByRole("link", { name: "manage", exact: true })).toHaveCount(0);
});
