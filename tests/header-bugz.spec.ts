import { expect, test, type Page } from "@playwright/test";
import { AbiCoder } from "ethers";

const abiCoder = AbiCoder.defaultAbiCoder();
const localIdentity = {
  address: "0x47e727b6fd24efd9cc74eb5d9153e94c82681d3c",
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
  result?: unknown;
  error?: { code: number; message: string };
};

const seedLocalIdentity = async (page: Page): Promise<void> => {
  await page.addInitScript((identity) => {
    window.localStorage.setItem("cheapbugs.localXmtpIdentity.v1", JSON.stringify(identity));
  }, localIdentity);
};

const fulfillRpc = async (
  page: Page,
  url: string,
  handler: (request: RpcRequest) => RpcResponse
): Promise<void> => {
  await page.route(url, async (route) => {
    const payload = JSON.parse(route.request().postData() || "{}") as RpcRequest | RpcRequest[];
    const requests = Array.isArray(payload) ? payload : [payload];
    const responses = requests.map(handler);

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(Array.isArray(payload) ? responses : responses[0])
    });
  });
};

const mockEnsRpc = async (page: Page): Promise<void> => {
  await fulfillRpc(page, "https://ethereum-rpc.publicnode.com/**", (request) => ({
    id: request.id,
    jsonrpc: "2.0",
    result: request.method === "eth_chainId" ? "0x1" : "0x"
  }));
};

const mockBaseRpc = async (page: Page): Promise<{ counts: { balanceOf: number; nativeBalance: number } }> => {
  const counts = { balanceOf: 0, nativeBalance: 0 };

  await fulfillRpc(page, "https://mainnet.base.org/**", (request) => {
    switch (request.method) {
      case "eth_chainId":
        return { id: request.id, jsonrpc: "2.0", result: "0x2105" };
      case "net_version":
        return { id: request.id, jsonrpc: "2.0", result: "8453" };
      case "eth_getBalance":
        counts.nativeBalance += 1;
        return { id: request.id, jsonrpc: "2.0", result: "0x0" };
      case "eth_call": {
        const call = (request.params?.[0] ?? {}) as { data?: string };
        const selector = call.data?.slice(0, 10).toLowerCase();
        if (selector === "0x70a08231") {
          counts.balanceOf += 1;
          return { id: request.id, jsonrpc: "2.0", result: abiCoder.encode(["uint256"], [1_234n * 10n ** 18n]) };
        }

        return { id: request.id, jsonrpc: "2.0", result: "0x" };
      }
      default:
        return { id: request.id, jsonrpc: "2.0", result: "0x" };
    }
  });

  return { counts };
};

test("header BUGZ status avoids treasury dashboard reads on ordinary routes", async ({ page }) => {
  const consoleInfos: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "info") {
      consoleInfos.push(message.text());
    }
  });
  await seedLocalIdentity(page);
  await mockEnsRpc(page);
  const { counts } = await mockBaseRpc(page);

  await page.goto("/submit");

  await expect(page.locator(".bugz-chip")).toContainText("1,234 BUGZ");
  expect(counts.balanceOf).toBe(1);
  expect(counts.nativeBalance).toBe(0);
  expect(consoleInfos.some((text) => text.includes("[cheapbugs] app: rendered route"))).toBe(false);
});

test("header BUGZ rate limits warn without loud console errors", async ({ page }) => {
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
    if (message.type() === "warning") {
      consoleWarnings.push(message.text());
    }
  });

  await seedLocalIdentity(page);
  await mockEnsRpc(page);
  await fulfillRpc(page, "https://mainnet.base.org/**", (request) => {
    switch (request.method) {
      case "eth_chainId":
        return { id: request.id, jsonrpc: "2.0", result: "0x2105" };
      case "net_version":
        return { id: request.id, jsonrpc: "2.0", result: "8453" };
      case "eth_call":
        return { id: request.id, jsonrpc: "2.0", error: { code: 429, message: "Too Many Requests" } };
      default:
        return { id: request.id, jsonrpc: "2.0", result: "0x" };
    }
  });

  await page.goto("/submit");

  await expect(page.locator(".bugz-chip")).toContainText("unavailable");
  await expect
    .poll(() => consoleWarnings.some((text) => text.includes("[cheapbugs] token: header BUGZ status rate-limited")))
    .toBe(true);
  expect(consoleErrors.some((text) => text.includes("[cheapbugs] token: header BUGZ status load failed"))).toBe(false);
});
