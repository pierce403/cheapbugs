import { expect, test, type Page, type Route } from "@playwright/test";
import { createCipheriv, createHash } from "node:crypto";
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
const revealedDetailsKeyBytes = Buffer.from("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "hex");
const revealedDetailsKey = `0x${revealedDetailsKeyBytes.toString("hex")}`;

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

type ReportTupleOptions = {
  revealed?: boolean;
  encryptedDetailsHash?: string;
  detailsKeyCommitment?: string;
  publicSummary?: string;
};

const base64Url = (value: Uint8Array): string => Buffer.from(value).toString("base64url");

const encryptedBugBundle = (options: { details?: string; reproSteps?: string; evidence?: string; contactHints?: string } = {}) => {
  const iv = Buffer.from("202122232425262728292a2b", "hex");
  const aad = Buffer.from("cheapbugs report detail test", "utf8");
  const plaintext = Buffer.from(
    JSON.stringify({
      details: options.details ?? "Use a malformed parser envelope to trigger arbitrary settlement.",
      repro_steps: options.reproSteps ?? "Send the crafted envelope to the Base parser endpoint.",
      evidence: options.evidence ?? "Crash log and trace attached out of band.",
      contact_hints: options.contactHints ?? "alice@example.test"
    }),
    "utf8"
  );
  const cipher = createCipheriv("aes-256-gcm", revealedDetailsKeyBytes, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  const encryptedDetailsHash = `0x${createHash("sha256").update(ciphertext).digest("hex")}`;
  const detailsKeyCommitment = `0x${createHash("sha256").update(revealedDetailsKeyBytes).digest("hex")}`;

  return {
    accessKey: base64Url(revealedDetailsKeyBytes),
    encryptedDetailsHash,
    detailsKeyCommitment,
    payload: {
      schema: "cheapbugs.bug_bundle.v1",
      version: 1,
      core: {
        submission: {
          bug_type: "web3",
          severity: "critical",
          target_interest: "high",
          title: "Live parser exploit",
          public_summary: "Fresh broker-published bug from chain.",
          target: {
            kind: "protocol",
            reference: "Base protocol parser"
          }
        },
        details: {
          encrypted: true,
          alg: "AES-256-GCM",
          iv: base64Url(iv),
          aad: base64Url(aad),
          ciphertext: base64Url(ciphertext)
        },
        commitments: {
          encrypted_details_sha256: encryptedDetailsHash,
          details_key_commitment: detailsKeyCommitment,
          details_key_commitment_alg: "sha256"
        }
      }
    }
  };
};

const reportTuple = (options: ReportTupleOptions = {}) => [
  reportHash,
  "CB-LIVE-0001",
  reporterAddress,
  1_779_120_000n,
  2,
  options.publicSummary ?? "Fresh broker-published bug from chain.",
  "ipfs://bafyreportdetail",
  4,
  id("base-protocol"),
  "base, parser",
  id("public-content"),
  id("bug-bundle"),
  options.encryptedDetailsHash ?? id("encrypted-details"),
  options.detailsKeyCommitment ?? id("details-key"),
  BigInt(Math.floor(Date.now() / 1000) + 604_800),
  options.revealed ? revealedDetailsKey : zeroBytes32,
  Boolean(options.revealed),
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

const mockBaseRpc = async (page: Page, options: ReportTupleOptions = {}): Promise<void> => {
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
            result: bugIndexInterface.encodeFunctionResult("getReport", [reportTuple(options)])
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

const mockBugBundleGateway = async (page: Page, payload?: unknown): Promise<void> => {
  await page.route("https://ipfs.io/ipfs/bafyreportdetail", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(payload ?? {
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

test("report detail stores revealed onchain key and decrypts details automatically", async ({ page }) => {
  const revealedBundle = encryptedBugBundle();
  await seedReviewSchema(page);
  await mockBaseRpc(page, {
    revealed: true,
    encryptedDetailsHash: revealedBundle.encryptedDetailsHash,
    detailsKeyCommitment: revealedBundle.detailsKeyCommitment
  });
  await mockEnsRpc(page);
  await mockBugBundleGateway(page, revealedBundle.payload);
  await mockEasGraphql(page);

  await page.goto(`/report/${reportHash}`);

  const privateSection = page.locator("section").filter({ hasText: "[ private details ]" });
  await expect(privateSection).toContainText("Use a malformed parser envelope to trigger arbitrary settlement.");
  await expect(privateSection).toContainText("Send the crafted envelope to the Base parser endpoint.");
  await expect(privateSection).toContainText("alice@example.test");
  await expect(privateSection.getByRole("button", { name: "buy early access" })).toHaveCount(0);

  const storedKey = await page.evaluate((hash) => {
    const raw = window.localStorage.getItem("cheapbugs.report-access");
    return raw ? (JSON.parse(raw) as Record<string, string>)[hash] : null;
  }, reportHash);
  expect(storedKey).toBe(revealedBundle.accessKey);
});

test("report detail renders markdown summary and details with copyable code blocks", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as Window & { __copiedCode?: string }).__copiedCode = text;
        }
      }
    });
  });

  const publicSummary = [
    "**Critical summary**",
    "",
    "- parser accepts forged proof",
    "",
    "```ts",
    'const result = "owned";',
    "```",
    "",
    "<script>alert(1)</script>"
  ].join("\n");
  const details = [
    "# Exploit details",
    "",
    "Run `forge test` then:",
    "",
    "```sh",
    "curl -sS https://example.test/poc",
    "```",
    "",
    "[docs](javascript:alert(1)) [safe](https://example.com/poc)"
  ].join("\n");
  const revealedBundle = encryptedBugBundle({ details });

  await seedReviewSchema(page);
  await mockBaseRpc(page, {
    revealed: true,
    encryptedDetailsHash: revealedBundle.encryptedDetailsHash,
    detailsKeyCommitment: revealedBundle.detailsKeyCommitment,
    publicSummary
  });
  await mockEnsRpc(page);
  await mockBugBundleGateway(page, revealedBundle.payload);
  await mockEasGraphql(page);

  await page.goto(`/report/${reportHash}`);

  const reportSection = page.locator("section").filter({ hasText: "[ Live parser exploit ]" });
  await expect(reportSection.locator(".report-title-text").first()).toHaveCSS("font-weight", "700");

  const summaryBlock = reportSection.locator(".report-text-block").filter({ hasText: "summary" });
  await expect(summaryBlock.locator("strong")).toContainText("Critical summary");
  await expect(summaryBlock.locator("li")).toContainText("parser accepts forged proof");
  await expect(summaryBlock.locator("script")).toHaveCount(0);
  await expect(summaryBlock).toContainText("<script>alert(1)</script>");
  await summaryBlock.getByRole("button", { name: "copy" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as Window & { __copiedCode?: string }).__copiedCode))
    .toBe('const result = "owned";');

  const privateSection = page.locator("section").filter({ hasText: "[ private details ]" });
  const detailsBlock = privateSection.locator(".report-text-block").filter({ hasText: "details" });
  await expect(detailsBlock.locator("h1")).toHaveText("Exploit details");
  await expect(detailsBlock.locator("code").filter({ hasText: "forge test" })).toBeVisible();
  await expect(detailsBlock.getByRole("link", { name: "docs" })).toHaveCount(0);
  await expect(detailsBlock.getByRole("link", { name: "safe" })).toHaveAttribute("href", "https://example.com/poc");
  await detailsBlock.getByRole("button", { name: "copy" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as Window & { __copiedCode?: string }).__copiedCode))
    .toBe("curl -sS https://example.test/poc");
});
