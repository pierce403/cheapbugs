import { expect, test, type Page, type Route } from "@playwright/test";
import { AbiCoder, Interface, id } from "ethers";

import { bugIndexAbi } from "../src/contracts/bugIndexAbi";

const bugIndexAddress = "0x515FDbc9876aC26870794E26605c7DD04c18679b";
const bondVaultAddress = "0x2Eab99B6d6F1FBDa4fa78a00662E0cf9aBd9f3d3";
const multicallAddress = "0xcA11bde05977b3631167028862bE2a173976CA11";
const reporterAddress = "0x1234567890123456789012345678901234567890";
const reportHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const zeroBytes32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const abiCoder = AbiCoder.defaultAbiCoder();
const bugIndexInterface = new Interface(bugIndexAbi);
const bondVaultInterface = new Interface([
  "function accountOf(address accountAddress) view returns (tuple(uint256 active,uint256 pendingWithdrawal,uint64 withdrawAvailableAt))"
]);
const multicallInterface = new Interface([
  "function aggregate3(tuple(address target,bool allowFailure,bytes callData)[] calls) view returns (tuple(bool success,bytes returnData)[] returnData)"
]);
const latestReportHashesSelector = bugIndexInterface.getFunction("latestReportHashes")?.selector;
const getReportSelector = bugIndexInterface.getFunction("getReport")?.selector;
const upVoteWeightSelector = bugIndexInterface.getFunction("upVoteWeight")?.selector;
const downVoteWeightSelector = bugIndexInterface.getFunction("downVoteWeight")?.selector;
const getBondVoteSelector = bugIndexInterface.getFunction("getBondVote")?.selector;
const accountOfSelector = bondVaultInterface.getFunction("accountOf")?.selector;
const aggregate3Selector = multicallInterface.getFunction("aggregate3")?.selector;
const reverseSelector = id("reverseWithGateways(bytes,uint256,string[])").slice(0, 10);
const resolveSelector = id("resolveWithGateways(bytes,bytes,string[])").slice(0, 10);
const zeroAddress = "0x0000000000000000000000000000000000000000";
const revealDelayMs = 2 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000 + 30 * 60 * 1000;
const localIdentity = {
  address: "0x47e727b6fd24efd9cc74eb5d9153e94c82681d3c",
  privateKey: "0x59c6995e998f97a5a0044966f0945383e9dade06e38b2b0b020a74d5cc78a4f3",
  mnemonic: "test test test test test test test test test test test junk",
  derivationPath: "m/44'/60'/0'/0/0",
  createdAt: "2026-05-17T00:00:00.000Z"
};

type MockBaseRpcOptions = {
  upVoteWeight?: bigint;
  downVoteWeight?: bigint;
  voterSupport?: boolean | null;
  voterWeight?: bigint;
  bondActive?: bigint;
};

const revealAfterDate = () => new Date(Date.now() + revealDelayMs);

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

const reportTuple = () => {
  const createdAt = 1_779_120_000n;
  const revealAfter = BigInt(Math.floor(revealAfterDate().getTime() / 1000));
  return [
    reportHash,
    "CB-LIVE-0001",
    reporterAddress,
    createdAt,
    2,
    "Fresh broker-published bug from chain.",
    "ipfs://bafyrecentbug",
    4,
    id("base-protocol"),
    "base, parser",
    id("public-content"),
    id("bug-bundle"),
    id("encrypted-details"),
    id("details-key"),
    revealAfter,
    zeroBytes32,
    false,
    0,
    false,
    0n,
    0
  ];
};

const submissionPublic = () => ({
  reportId: "CB-LIVE-0001",
  reportHash,
  reporterAddress,
  createdAt: new Date(1_779_120_000 * 1000).toISOString(),
  disclosureMode: "public",
  publicSummary: "Fresh broker-published bug from chain.",
  encryptedPayloadCid: "ipfs://bafyrecentbug",
  targetKind: "protocol",
  targetRefHash: id("base-protocol"),
  tags: ["base", "parser"],
  contentHash: id("public-content"),
  bugBundleHash: id("bug-bundle"),
  encryptedDetailsHash: id("encrypted-details"),
  detailsKeyCommitment: id("details-key"),
  revealAfter: revealAfterDate().toISOString(),
  detailsKeyRevealed: false
});

const bugBundlePayload = () => ({
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
});

const seedLocalIdentity = async (page: Page): Promise<void> => {
  await page.addInitScript((identity) => {
    window.localStorage.setItem("cheapbugs.localXmtpIdentity.v1", JSON.stringify(identity));
  }, localIdentity);
};

const mockBaseRpc = async (
  page: Page,
  options: MockBaseRpcOptions = {}
): Promise<{ counts: { latest: number; getReport: number } }> => {
  const counts = { latest: 0, getReport: 0 };
  const upVoteWeight = options.upVoteWeight ?? 0n;
  const downVoteWeight = options.downVoteWeight ?? 0n;
  const voterSupport = options.voterSupport ?? null;
  const voterWeight = options.voterWeight ?? 0n;
  const bondActive = options.bondActive ?? 0n;

  const voteResultFor = (selector: string | undefined): string | null => {
    if (selector === upVoteWeightSelector) {
      return bugIndexInterface.encodeFunctionResult("upVoteWeight", [upVoteWeight]);
    }
    if (selector === downVoteWeightSelector) {
      return bugIndexInterface.encodeFunctionResult("downVoteWeight", [downVoteWeight]);
    }
    if (selector === getBondVoteSelector) {
      return bugIndexInterface.encodeFunctionResult("getBondVote", [
        voterSupport === null
          ? [zeroBytes32, zeroAddress, 0n, false, 0n]
          : [reportHash, localIdentity.address, 1n, voterSupport, voterWeight]
      ]);
    }
    return null;
  };

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

        if (target === multicallAddress.toLowerCase() && selector === aggregate3Selector) {
          const [calls] = multicallInterface.decodeFunctionData("aggregate3", call.data ?? "0x") as [
            Array<{ target: string; callData: string; 0: string; 2: string }>
          ];
          const returnData = calls.map((entry) => {
            const nestedTarget = String(entry.target ?? entry[0]).toLowerCase();
            const nestedCallData = String(entry.callData ?? entry[2]);
            const nestedSelector = nestedCallData.slice(0, 10).toLowerCase();
            const voteResult =
              nestedTarget === bugIndexAddress.toLowerCase() ? voteResultFor(nestedSelector) : null;
            return {
              success: voteResult !== null,
              returnData: voteResult ?? "0x"
            };
          });
          return {
            id: request.id,
            jsonrpc: "2.0",
            result: multicallInterface.encodeFunctionResult("aggregate3", [returnData])
          };
        }

        if (target === bugIndexAddress.toLowerCase() && selector === latestReportHashesSelector) {
          counts.latest += 1;
          return {
            id: request.id,
            jsonrpc: "2.0",
            result: bugIndexInterface.encodeFunctionResult("latestReportHashes", [[reportHash]])
          };
        }

        if (target === bugIndexAddress.toLowerCase() && selector === getReportSelector) {
          counts.getReport += 1;
          return {
            id: request.id,
            jsonrpc: "2.0",
            result: bugIndexInterface.encodeFunctionResult("getReport", [reportTuple()])
          };
        }

        const voteResult = target === bugIndexAddress.toLowerCase() ? voteResultFor(selector) : null;
        if (voteResult) {
          return {
            id: request.id,
            jsonrpc: "2.0",
            result: voteResult
          };
        }

        if (target === bondVaultAddress.toLowerCase() && selector === accountOfSelector) {
          return {
            id: request.id,
            jsonrpc: "2.0",
            result: bondVaultInterface.encodeFunctionResult("accountOf", [[bondActive, 0n, 0n]])
          };
        }

        if (selector === "0x70a08231") {
          return {
            id: request.id,
            jsonrpc: "2.0",
            result: abiCoder.encode(["uint256"], [420n * 10n ** 18n])
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

  return { counts };
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
          const avatarResult = abiCoder.encode(["string"], [""]);
          return {
            id: request.id,
            jsonrpc: "2.0",
            result: abiCoder.encode(["bytes", "address"], [avatarResult, zeroAddress])
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

const mockBugBundleGateway = async (
  page: Page,
  options: { delayMs?: number } = {}
): Promise<{ counts: { bundle: number } }> => {
  const counts = { bundle: 0 };
  await page.route("https://ipfs.io/ipfs/bafyrecentbug", async (route) => {
    counts.bundle += 1;
    if (options.delayMs) {
      await new Promise((resolve) => {
        setTimeout(resolve, options.delayMs);
      });
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(bugBundlePayload())
    });
  });

  return { counts };
};

const seedExpiredReportCaches = async (page: Page): Promise<void> => {
  await page.addInitScript(
    ({ address, hash, report, bundle }) => {
      const expiredRecord = (value: unknown) =>
        JSON.stringify({
          value,
          expiresAt: Date.now() - 1
        });

      window.localStorage.setItem(`cheapbugs.bugIndex.v2:latest:${address}:12`, expiredRecord([report]));
      window.localStorage.setItem(`cheapbugs.bugIndex.v2:report:${address}:${hash}`, expiredRecord(report));
      window.localStorage.setItem("cheapbugs.ipfs:ipfs-gateway:ipfs://bafyrecentbug", expiredRecord(bundle));
    },
    {
      address: bugIndexAddress,
      hash: reportHash,
      report: submissionPublic(),
      bundle: bugBundlePayload()
    }
  );
};

test("renders newly indexed onchain bugs in recent reports", async ({ page }) => {
  const { counts } = await mockBaseRpc(page);
  await mockEnsRpc(page);
  const gateway = await mockBugBundleGateway(page);

  await page.goto("/");

  await expect(page.getByText("public goods crowdfunding protocol")).toBeVisible();
  await expect(page.getByText(`bug index: ${bugIndexAddress}`)).toHaveCount(0);
  await expect(page.getByText("bond vault:")).toHaveCount(0);
  await expect(page.getByText("treasury vault:")).toHaveCount(0);
  await expect(page.getByText("[ patrons of the arts ]")).toHaveCount(0);
  await expect(page.getByText("static assets only")).toHaveCount(0);

  const recentReports = page.locator("section").filter({ hasText: "[ recent reports ]" });
  await expect(recentReports.locator("thead th")).toHaveText(["score", "title", "author", "date", "unlock"]);
  const scoreHeaderBox = await recentReports.locator("thead th").nth(0).boundingBox();
  const dateHeaderBox = await recentReports.locator("thead th").nth(3).boundingBox();
  const unlockHeaderBox = await recentReports.locator("thead th").nth(4).boundingBox();
  expect(scoreHeaderBox?.width ?? 0).toBeLessThanOrEqual(110);
  expect(dateHeaderBox?.width ?? 0).toBeLessThanOrEqual(230);
  expect(unlockHeaderBox?.width ?? 0).toBeLessThanOrEqual(116);
  const authorHeader = recentReports.locator("thead th").nth(2);
  await expect(authorHeader).toHaveCSS("white-space", "nowrap");
  const authorHeaderBox = await authorHeader.boundingBox();
  expect(authorHeaderBox?.width ?? 0).toBeGreaterThan(160);
  const reportRow = recentReports.getByRole("row").filter({ hasText: "Live parser exploit" });
  await expect(reportRow.locator("td").nth(0).locator(".bug-vote-score")).toHaveText("0");
  const titleLink = reportRow.getByRole("link", { name: "Live parser exploit" });
  await expect(titleLink).toBeVisible();
  await expect(titleLink).toHaveCSS("text-decoration-line", "underline");
  await expect(titleLink).toHaveCSS("text-underline-offset", "3px");
  await expect(reportRow.locator("td").nth(2)).toContainText("alice.eth");
  await expect(reportRow.locator("td").nth(3)).toContainText("May 18, 2026");
  await expect(reportRow.locator("td").nth(4)).toHaveText("2d 4h");
  await expect(reportRow.locator("td").nth(4)).toHaveCSS("text-align", "right");
  await expect(reportRow.getByRole("button", { name: "buy early access to Live parser exploit" })).toBeVisible();
  await expect(recentReports.getByText("No onchain bug reports resolved yet.")).toHaveCount(0);

  expect(counts.latest).toBeGreaterThan(0);
  expect(counts.getReport).toBeGreaterThan(0);
  expect(gateway.counts.bundle).toBe(1);

  await reportRow.getByRole("button", { name: "buy early access to Live parser exploit" }).click();
  const unlockDialog = page.getByRole("dialog", { name: "detail unlock" });
  await expect(unlockDialog).toBeVisible();
  await expect(unlockDialog).toContainText("Connect a wallet before buying detail access.");
  await unlockDialog.getByRole("button", { name: "close" }).click();
  await expect(unlockDialog).toBeHidden();

  const countsAfterFirstRender = { ...counts };
  const gatewayCallsAfterFirstRender = gateway.counts.bundle;
  await page.getByRole("link", { name: "submit" }).click();
  await expect(page).toHaveURL(/\/submit$/);
  await page.getByRole("link", { name: "index" }).click();
  await expect(reportRow.locator("td").nth(1)).toContainText("Live parser exploit");
  await expect(reportRow.locator("td").nth(4)).toHaveText("2d 4h");
  expect(counts).toEqual(countsAfterFirstRender);
  expect(gateway.counts.bundle).toBe(gatewayCallsAfterFirstRender);

  await page.reload();
  const reloadedRecentReports = page.locator("section").filter({ hasText: "[ recent reports ]" });
  const reloadedReportRow = reloadedRecentReports.getByRole("row").filter({ hasText: "Live parser exploit" });
  await expect(reloadedReportRow.locator("td").nth(4)).toHaveText("2d 4h");
  expect(counts).toEqual(countsAfterFirstRender);
  expect(gateway.counts.bundle).toBe(gatewayCallsAfterFirstRender);

  await reloadedReportRow.getByRole("link", { name: "alice.eth" }).click();
  await expect(page).toHaveURL(new RegExp(`/profile/${reporterAddress}$`));
  await expect(page.locator(".profile-page-panel")).toContainText("alice.eth");
  await expect(page.locator(".profile-page-panel")).toContainText("420 BUGZ");
  const profileSubmissions = page.locator("section").filter({ hasText: "[ previous submissions ]" });
  await expect(profileSubmissions.locator("thead th")).toHaveText(["date", "title", "target", "author", "details"]);
  await expect(profileSubmissions).toContainText("Live parser exploit");
  await expect(profileSubmissions).toContainText("2d 4h");
});

test("uses a loading title placeholder while BugBundle metadata is still propagating", async ({ page }) => {
  await mockBaseRpc(page);
  await mockEnsRpc(page);
  await mockBugBundleGateway(page, { delayMs: 2_500 });

  await page.goto("/");

  const recentReports = page.locator("section").filter({ hasText: "[ recent reports ]" });
  const loadingRow = recentReports.getByRole("row").filter({ hasText: "loading..." });
  await expect(loadingRow).toBeVisible();
  await expect(recentReports.getByText("CB-LIVE-0001")).toHaveCount(0);

  await page.waitForTimeout(800);
  await page.getByRole("link", { name: "submit" }).click();
  await expect(page).toHaveURL(/\/submit$/);
  await page.getByRole("link", { name: "index" }).click();

  await expect(recentReports.getByRole("row").filter({ hasText: "Live parser exploit" })).toBeVisible();
});

test("shows bonded vote totals and sends level-zero voters to bonding", async ({ page }) => {
  await seedLocalIdentity(page);
  await mockBaseRpc(page, {
    upVoteWeight: 7n,
    downVoteWeight: 2n,
    voterSupport: true,
    voterWeight: 3n,
    bondActive: 0n
  });
  await mockEnsRpc(page);
  await mockBugBundleGateway(page);

  await page.goto("/");

  const recentReports = page.locator("section").filter({ hasText: "[ recent reports ]" });
  const reportRow = recentReports.getByRole("row").filter({ hasText: "Live parser exploit" });
  const voteControl = reportRow.locator(".bug-vote-control");

  await expect(voteControl.locator(".bug-vote-score")).toHaveText("5");

  const upvote = voteControl.getByRole("button", { name: /upvote Live parser exploit/i });
  const downvote = voteControl.getByRole("button", { name: /downvote Live parser exploit/i });
  await expect(upvote).toHaveAttribute("title", "total upvote weight: 7");
  await expect(downvote).toHaveAttribute("title", "total downvote weight: 2");
  await expect(upvote).toHaveClass(/is-selected/);
  await expect(downvote).not.toHaveClass(/is-selected/);

  await downvote.click();

  const dialog = page.getByRole("dialog", { name: "bond required" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Voting requires bonded BUGZ");

  await dialog.getByRole("button", { name: "go to bond" }).click();
  await expect(page).toHaveURL(/\/bond$/);
});

test("renders stale cached report and BugBundle details when providers rate limit", async ({ page }) => {
  await seedExpiredReportCaches(page);
  await mockEnsRpc(page);

  let baseCalls = 0;
  let gatewayCalls = 0;
  await page.route("https://mainnet.base.org/**", async (route) => {
    baseCalls += 1;
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Too Many Requests" } })
    });
  });
  await page.route("https://ipfs.io/ipfs/bafyrecentbug", async (route) => {
    gatewayCalls += 1;
    await route.fulfill({
      status: 429,
      contentType: "text/plain",
      body: "Too Many Requests"
    });
  });

  await page.goto("/");

  const recentReports = page.locator("section").filter({ hasText: "[ recent reports ]" });
  const reportRow = recentReports.getByRole("row").filter({ hasText: "Live parser exploit" });
  await expect(reportRow.locator("td").nth(1)).toContainText("Live parser exploit");
  await expect(reportRow.locator("td").nth(4)).toHaveText("2d 4h");
  expect(baseCalls).toBeGreaterThan(0);
  expect(gatewayCalls).toBe(1);
});
