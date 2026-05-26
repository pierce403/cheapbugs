import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
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

const fulfillRpc = async (
  page: Page,
  url: string,
  handler: (request: RpcRequest) => RpcResponse,
  options: { rejectBatch?: boolean } = {}
): Promise<void> => {
  await page.route(url, async (route) => {
    const payload = JSON.parse(route.request().postData() || "{}") as RpcRequest | RpcRequest[];
    if (Array.isArray(payload) && options.rejectBatch) {
      throw new Error("unexpected JSON-RPC batch");
    }
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
): Promise<{ counts: { reverse: number; avatar: number } }> => {
  const counts = { reverse: 0, avatar: 0 };
  await fulfillRpc(page, "https://ethereum-rpc.publicnode.com/**", (request) => {
    switch (request.method) {
      case "eth_chainId":
        return { id: request.id, jsonrpc: "2.0", result: "0x1" };
      case "eth_call": {
        const call = (request.params?.[0] ?? {}) as { data?: string };
        const selector = call.data?.slice(0, 10).toLowerCase();

        if (selector === reverseSelector) {
          counts.reverse += 1;
          return {
            id: request.id,
            jsonrpc: "2.0",
            result: abiCoder.encode(["string", "address", "address"], [options.ensName ?? "", zeroAddress, zeroAddress])
          };
        }

        if (selector === resolveSelector) {
          counts.avatar += 1;
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
  return { counts };
};

test("opens an ENS-backed profile modal from the avatar", async ({ page }) => {
  const avatarUrl = "https://example.com/cheapbugs-avatar.png";
  await seedLocalIdentity(page);
  await mockBaseRpc(page);
  await mockEnsRpc(page, { ensName: "cheapbugs.eth", avatarUrl });
  await page.route(avatarUrl, async (route) => {
    if (route.request().method() === "HEAD") {
      await route.fulfill({ status: 405 });
      return;
    }

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

test("offers an embedded wallet when the user has no crypto wallet", async ({ page }) => {
  await mockBaseRpc(page);
  await mockEnsRpc(page, { ensName: null });

  await page.goto("/");
  await page.getByRole("button", { name: "login" }).click();

  const connectDialog = page.getByRole("dialog", { name: "connect wallet" });
  await expect(connectDialog).toBeVisible();
  await expect(connectDialog).toContainText("WalletConnect is for people who already have a crypto wallet");
  await connectDialog.getByRole("button", { name: "I don't have a crypto wallet" }).click();

  const embeddedDialog = page.getByRole("dialog", { name: "embedded wallet" });
  await expect(embeddedDialog).toBeVisible();
  await expect(embeddedDialog).toContainText("smart contract transactions");
  await expect(embeddedDialog).toContainText("XMTP messages");
  await embeddedDialog.getByRole("button", { name: "generate embedded wallet" }).click();

  await expect(embeddedDialog).toBeHidden();
  await expect(page.locator(".auth-panel")).toContainText("no ENS name yet");
  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("cheapbugs.localXmtpIdentity.v1") || "{}"));
  expect(stored.address).toMatch(/^0x[0-9a-f]{40}$/);
  expect(stored.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
});

test("resets stale WalletConnect browser state from the connect modal", async ({ page }) => {
  await mockBaseRpc(page);
  await mockEnsRpc(page, { ensName: null });

  await page.goto("/");
  await page.evaluate(async () => {
    window.localStorage.setItem("wc@2:client:0.3//session", JSON.stringify({ stale: true }));
    window.localStorage.setItem("WALLETCONNECT_DEEPLINK_CHOICE", "stale");
    window.localStorage.setItem("tw.wc.requestedChains", "[8453]");
    window.localStorage.setItem(
      "tw:connected-wallet-params",
      JSON.stringify({ walletConnect: { pairingTopic: "stale" } })
    );
    window.sessionStorage.setItem("wc@2:pairing", "stale");
    await new Promise<void>((resolve, reject) => {
      const request = window.indexedDB.open("WALLET_CONNECT_V2_INDEXED_DB", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("keyvaluestorage");
      };
      request.onerror = () => reject(request.error ?? new Error("Failed to open WalletConnect IndexedDB."));
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });
  });

  await page.getByRole("button", { name: "login" }).click();
  const connectDialog = page.getByRole("dialog", { name: "connect wallet" });
  await connectDialog.getByRole("button", { name: "reset WalletConnect" }).click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const walletConnectKey = (key: string) =>
          key.toLowerCase().includes("walletconnect") ||
          key.startsWith("wc@") ||
          key.startsWith("tw.wc.") ||
          key === "tw:connected-wallet-params";

        return {
          localStorageKeys: Object.keys(window.localStorage).filter(walletConnectKey),
          sessionStorageKeys: Object.keys(window.sessionStorage).filter(walletConnectKey)
        };
      })
    )
    .toEqual({ localStorageKeys: [], sessionStorageKeys: [] });

  const databaseNames = await page.evaluate(async () =>
    window.indexedDB.databases ? (await window.indexedDB.databases()).map((database) => database.name) : []
  );
  expect(databaseNames).not.toContain("WALLET_CONNECT_V2_INDEXED_DB");
  await expect(page.locator(".notice")).toContainText("WalletConnect session reset");
});

test("imports an embedded wallet from cheapbugs-key.json", async ({ page }) => {
  await mockBaseRpc(page);
  await mockEnsRpc(page, { ensName: null });

  await page.goto("/");
  await page.getByRole("button", { name: "login" }).click();
  await page.getByRole("button", { name: "I don't have a crypto wallet" }).click();

  const keyFile = {
    schema: "cheapbugs-key.v1",
    type: "embedded_wallet",
    address: localIdentity.address,
    privateKey: localIdentity.privateKey,
    mnemonic: localIdentity.mnemonic,
    derivationPath: localIdentity.derivationPath,
    createdAt: localIdentity.createdAt,
    exportedAt: "2026-05-18T00:00:00.000Z"
  };
  await page.locator("#import-embedded-key-modal").setInputFiles({
    name: "cheapbugs-key.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(keyFile))
  });

  await expect(page.getByRole("dialog", { name: "embedded wallet" })).toBeHidden();
  await expect(page.locator(".auth-panel")).toContainText("no ENS name yet");
  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("cheapbugs.localXmtpIdentity.v1") || "{}"));
  expect(stored.address).toBe(localIdentity.address);
  expect(stored.privateKey).toBe(localIdentity.privateKey);
});

test("exports cheapbugs-key.json from the embedded wallet profile", async ({ page }) => {
  await seedLocalIdentity(page);
  await mockBaseRpc(page);
  await mockEnsRpc(page, { ensName: null });

  await page.goto("/");
  await page.getByRole("button", { name: "open profile" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "export cheapbugs-key.json" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("cheapbugs-key.json");
  const path = await download.path();
  expect(path).toBeTruthy();
  const exported = JSON.parse(await readFile(path!, "utf8"));
  expect(exported.schema).toBe("cheapbugs-key.v1");
  expect(exported.type).toBe("embedded_wallet");
  expect(exported.address).toBe(localIdentity.address);
  expect(exported.privateKey).toBe(localIdentity.privateKey);
});

test("shows loading and logs a loud console error when header BUGZ balance fails outside rate limits", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  await seedLocalIdentity(page);
  await fulfillRpc(
    page,
    "https://mainnet.base.org/**",
    (request) => {
      switch (request.method) {
        case "eth_chainId":
          return { id: request.id, jsonrpc: "2.0", result: "0x2105" };
        case "net_version":
          return { id: request.id, jsonrpc: "2.0", result: "8453" };
        case "eth_call": {
          const call = (request.params?.[0] ?? {}) as { data?: string };
          const selector = call.data?.slice(0, 10).toLowerCase();
          if (selector === "0x70a08231") {
            return {
              id: request.id,
              jsonrpc: "2.0",
              error: { code: -32000, message: "BUGZ balance RPC unavailable" }
            };
          }

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
        default:
          return { id: request.id, jsonrpc: "2.0", result: "0x" };
      }
    },
    { rejectBatch: true }
  );
  await mockEnsRpc(page, { ensName: null });

  await page.goto("/");

  const authPanel = page.locator(".auth-panel");
  await expect(authPanel).toContainText("bugz: loading");
  await expect(authPanel).toContainText("bugz: unavailable");
  await expect
    .poll(() => consoleErrors.some((text) => text.includes("[cheapbugs] token: header BUGZ status load failed")))
    .toBe(true);
});

test("loads ENS avatar text records without depending on a HEAD probe", async ({ page }) => {
  const avatarRecord = "ipfs://bafybeigdyrztuuvq6wtr4djs5h7kyf4e7d6hhi5m67zv6yn5m4cq/avatar.png";
  const gatewayUrl = "https://ipfs.io/ipfs/bafybeigdyrztuuvq6wtr4djs5h7kyf4e7d6hhi5m67zv6yn5m4cq/avatar.png";
  await seedLocalIdentity(page);
  await mockBaseRpc(page);
  await mockEnsRpc(page, { ensName: "cheapbugs.eth", avatarUrl: avatarRecord });
  await page.route(gatewayUrl, async (route) => {
    if (route.request().method() === "HEAD") {
      await route.fulfill({ status: 405 });
      return;
    }

    await route.fulfill({
      status: 200,
      headers: { "content-type": "image/png" },
      body: ""
    });
  });

  await page.goto("/");

  await expect(page.getByTestId("identity-avatar-media")).toHaveAttribute("src", gatewayUrl);

  await page.getByRole("button", { name: "open profile" }).click();
  await expect(page.getByTestId("profile-avatar-media")).toHaveAttribute("src", gatewayUrl);
});

test("caches ENS profile across reloads and refreshes from the profile modal", async ({ page }) => {
  const firstAvatarUrl = "https://example.com/cheapbugs-avatar.png";
  const freshAvatarUrl = "https://example.com/freshbugs-avatar.png";
  const ensState = { ensName: "cheapbugs.eth", avatarUrl: firstAvatarUrl };
  await seedLocalIdentity(page);
  await mockBaseRpc(page);
  const ensRpc = await mockEnsRpc(page, ensState);
  await page.route("https://example.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "image/png" },
      body: ""
    });
  });

  await page.goto("/");

  const authPanel = page.locator(".auth-panel");
  await expect(authPanel).toContainText("cheapbugs.eth");
  await expect(page.getByTestId("identity-avatar-media")).toHaveAttribute("src", firstAvatarUrl);
  expect(ensRpc.counts.reverse).toBe(1);
  expect(ensRpc.counts.avatar).toBe(1);

  await page.reload();
  await expect(authPanel).toContainText("cheapbugs.eth");
  await expect(page.getByTestId("identity-avatar-media")).toHaveAttribute("src", firstAvatarUrl);
  expect(ensRpc.counts.reverse).toBe(1);
  expect(ensRpc.counts.avatar).toBe(1);

  ensState.ensName = "freshbugs.eth";
  ensState.avatarUrl = freshAvatarUrl;
  await page.getByRole("button", { name: "open profile" }).click();
  await page.getByRole("button", { name: "refresh ENS profile" }).click();

  const dialog = page.getByRole("dialog", { name: "profile" });
  await expect(dialog).toContainText("freshbugs.eth");
  await expect(dialog.getByTestId("profile-avatar-media")).toHaveAttribute("src", freshAvatarUrl);
  expect(ensRpc.counts.reverse).toBe(2);
  expect(ensRpc.counts.avatar).toBe(2);
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
