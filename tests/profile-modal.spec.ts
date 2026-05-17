import { expect, test, type Page } from "@playwright/test";
import { AbiCoder, id } from "ethers";

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

const zeroAddress = "0x0000000000000000000000000000000000000000";
const reverseSelector = id("reverseWithGateways(bytes,uint256,string[])").slice(0, 10);
const resolveSelector = id("resolveWithGateways(bytes,bytes,string[])").slice(0, 10);

const seedLocalIdentity = async (page: Page): Promise<void> => {
  await page.addInitScript((identity) => {
    window.localStorage.setItem("cheapbugs.localXmtpIdentity.v1", JSON.stringify(identity));
  }, localIdentity);
};

const fulfillRpc = async (page: Page, url: string, handler: (request: RpcRequest) => RpcResponse): Promise<void> => {
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

const mockBaseRpc = async (page: Page): Promise<void> => {
  await fulfillRpc(page, "https://mainnet.base.org/**", (request) => {
    switch (request.method) {
      case "eth_chainId":
        return { id: request.id, jsonrpc: "2.0", result: "0x2105" };
      case "net_version":
        return { id: request.id, jsonrpc: "2.0", result: "8453" };
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
                  : selector === "0x70a08231"
                    ? abiCoder.encode(["uint256"], [1_234n * 10n ** 18n])
                    : "0x";
        return { id: request.id, jsonrpc: "2.0", result };
      }
      default:
        return { id: request.id, jsonrpc: "2.0", result: "0x" };
    }
  });
};

const mockEnsRpc = async (
  page: Page,
  options: {
    ensName: string | null;
    avatarUrl?: string;
  }
): Promise<void> => {
  await fulfillRpc(page, "https://ethereum-rpc.publicnode.com/**", (request) => {
    switch (request.method) {
      case "eth_chainId":
        return { id: request.id, jsonrpc: "2.0", result: "0x1" };
      case "eth_call": {
        const call = (request.params?.[0] ?? {}) as { data?: string };
        const selector = call.data?.slice(0, 10).toLowerCase();

        if (selector === reverseSelector) {
          return {
            id: request.id,
            jsonrpc: "2.0",
            result: abiCoder.encode(["string", "address", "address"], [options.ensName ?? "", zeroAddress, zeroAddress])
          };
        }

        if (selector === resolveSelector) {
          const avatarResult = abiCoder.encode(["string"], [options.avatarUrl ?? ""]);
          return {
            id: request.id,
            jsonrpc: "2.0",
            result: abiCoder.encode(["bytes", "address"], [avatarResult, zeroAddress])
          };
        }

        return { id: request.id, jsonrpc: "2.0", result: "0x" };
      }
      default:
        return { id: request.id, jsonrpc: "2.0", result: "0x" };
    }
  });
};

test("opens an ENS-backed profile modal from the avatar", async ({ page }) => {
  const avatarUrl = "https://example.com/cheapbugs-avatar.png";
  await seedLocalIdentity(page);
  await mockBaseRpc(page);
  await mockEnsRpc(page, { ensName: "cheapbugs.eth", avatarUrl });
  await page.route(avatarUrl, async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "image/png" },
      body: ""
    });
  });

  await page.goto("/");

  const authPanel = page.locator(".auth-panel");
  await expect(authPanel).toContainText("cheapbugs.eth");
  await expect(authPanel).toContainText("1,234 BUGZ");
  await expect(authPanel).not.toContainText("chain:");
  await expect(authPanel).not.toContainText("storage:");
  await expect(authPanel).not.toContainText("wallet:");
  await expect(authPanel).not.toContainText("siwe:");
  await expect(page.getByTestId("identity-avatar-media")).toHaveAttribute("src", avatarUrl);

  await page.getByRole("button", { name: "open profile" }).click();

  const dialog = page.getByRole("dialog", { name: "profile" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("cheapbugs.eth");
  await expect(dialog).toContainText("1,234 BUGZ");
  await expect(dialog.getByTestId("profile-avatar-media")).toHaveAttribute("src", avatarUrl);
  await expect(dialog.getByRole("link", { name: "edit ENS profile" })).toHaveAttribute(
    "href",
    "https://app.ens.domains/cheapbugs.eth"
  );
});

test("prompts connected wallets without ENS to register a name", async ({ page }) => {
  await seedLocalIdentity(page);
  await mockBaseRpc(page);
  await mockEnsRpc(page, { ensName: null });

  await page.goto("/");
  await expect(page.getByText("no ENS name yet")).toBeVisible();

  await page.getByRole("button", { name: "open profile" }).click();

  const dialog = page.getByRole("dialog", { name: "profile" });
  await expect(dialog).toContainText("No ENS primary name was found");
  await expect(dialog.getByRole("link", { name: "register ENS name" })).toHaveAttribute(
    "href",
    "https://app.ens.domains/"
  );
});
