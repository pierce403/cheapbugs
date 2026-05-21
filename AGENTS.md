# AGENTS.md - Instructions for Coding Agents

## Self-Improvement Directive

Read this file at the start of every task. Update it before you finish whenever you learn something important about this codebase, its workflow, or the collaborator's preferences.

Also read `FEATURES.md` at the start of every task that touches feature behavior, system design, data flow, deployment shape, contracts, storage, auth, or vendor integrations.

Also read `SECURITY.md` at the start of every task that touches signatures, broker authority, smart-contract attribution, private report handling, IPFS, EAS, payouts, or trust assumptions.

Record both wins to repeat and mistakes to avoid. Prefer exact commands, concrete file paths, and specific implementation notes over vague summaries.

This file is intentionally inspired by the recurse.bot idea: each agent should leave the project easier for the next one.

## Task Completion Workflow

After every completed task:

1. Run the relevant verification commands.
2. Update `AGENTS.md` if you learned anything useful.
3. Update `FEATURES.md` if the task changed feature behavior, system boundaries, integrations, deployment assumptions, milestones, tests, or the recommended code-navigation map.
4. Stage the completed work.
5. Commit it with a clear message.
6. Push it to the current branch on `origin`.
7. Only then send the final completion message to the user, including the commit SHA or a clear push failure note.

Default rule: do not leave completed work uncommitted or unpushed, and do not report a task as done before the push attempt has happened.

Allowed exceptions:

- The user explicitly says not to commit or not to push.
- The task is still in an intermediate or broken state and is not actually complete.
- Push fails because of auth, branch protection, or network issues. In that case, report the failure clearly.

## Project Overview

CheapBugs is a static Vite + TypeScript application for Base-native bug reporting and review.

Current architecture:

- public-safe report metadata is written onchain to the `CheapBugsBugIndex` contract on Base by authorized brokers with reporter EIP-712 signatures
- BUGZ bonds live in `CheapBugsBondVault`, and treasury/detail-key/reward flows live in `CheapBugsTreasuryVault`
- private report details are encrypted in the browser and uploaded to IPFS
- reviewer verdicts are written as EAS attestations on Base
- auth and wallet connectivity use Thirdweb external wallets plus a browser-stored embedded CheapBugs wallet fallback

## Verified Commands

Use these first when validating work:

```bash
npm install
npm run dev
npm run build
npm run test:e2e
npm run contracts:build
npm run contracts:test
npm run launch:bug-index:dry-run
npm run launch:bug-index:forge:dry-run
npm run launch:bug-index
```

## Key Paths

- `contracts/CheapBugsBugIndex.sol`: broker-published Base bug index contract with EIP-712 reporter signatures, bonded voting, key reveal, admin status, and ordered payout coordination
- `contracts/CheapBugsBondVault.sol`: live BUGZ bond escrow with 7-day delayed withdrawals, slashers, and log10 voting levels
- `contracts/CheapBugsTreasuryVault.sol`: live BUGZ treasury, detail-key payment records, broker allowlist, and index-gated reward payouts
- `cheapbugs.png`: source brand/social artwork dropped at the repo root
- `public/cheapbugs.png`, `public/cheapbugs-mark.png`, `public/og-image.png`, `public/favicon.png`, `public/favicon.ico`, `public/apple-touch-icon.png`: served brand, OpenGraph, and icon assets derived from `cheapbugs.png`
- `playwright.config.ts` and `tests/`: Playwright browser tests; add coverage here for UI features
- `script/LaunchBugIndex.s.sol`: Foundry deploy script for the bug index contract
- `test/CheapBugsBugIndex.t.sol`: Foundry scenario and fuzz tests for broker publishing, reporter signatures, voting, reveal, and ordered payouts
- `test/CheapBugsBondVault.t.sol`: Foundry unit and fuzz tests for BUGZ bonding, withdrawal delays, cancellation, slashing, and levels
- `test/CheapBugsBondVaultInvariant.t.sol`: Foundry invariant test for bond-vault accounting across randomized operations
- `test/CheapBugsTreasuryVault.t.sol`: Foundry unit and fuzz tests for detail-key purchases and index-gated payouts
- `scripts/launch-bug-index.mjs`: compile/deploy launcher for the CheapBugs contract suite
- `scripts/launch-bug-index-forge.sh`: shell wrapper for the Forge bug index launcher
- `deployments/base-8453/cheapbugs-contract-suite.latest.json`: tracked reproducibility manifest for the latest CheapBugs contract-suite dry run or deployment
- `deployments/base-8453/generated/latest/`: tracked generated Foundry artifacts for the latest contract-suite build
- `src/contracts/bugIndex.ts`: frontend read/write adapter for the bug index contract
- `src/contracts/cheapbugsSuite.ts`: frontend owner/read/write adapter for CheapBugs contract-suite management
- `src/contracts/bondVault.ts`: frontend bond-vault adapter for BUGZ approval, bonding, delayed withdrawals, and level reads
- `src/contracts/treasuryVault.ts`: frontend read/write adapter for treasury payout reads, detail-key payment approval, and `purchaseDetailKey`
- `src/contracts/priceFeeds.ts`: frontend Chainlink ETH/USD feed adapter for treasury USD estimates
- `src/contracts/bugzToken.ts`: read-only BUGZ adapter for metadata, connected-wallet balances, optional treasury stats, and patron scans
- `src/contracts/bugzTrade.ts`: static frontend Uniswap v4 trade adapter for BUGZ buy/sell on Base
- `src/contracts/bugzTokenAbi.ts`: generated frontend ABI module for the BUGZ token contract
- `src/auth/thirdweb.ts`: Thirdweb external wallets, CheapBugs WalletConnect handoff, embedded-wallet import/export, local SIWE proof, and signer adapter
- `src/app.ts`: site shell, top-level navigation, session chrome, and site-wide development banner
- `src/auth/localIdentity.ts`: browser-stored embedded wallet identity helper and `cheapbugs-key.json` parser/serializer
- `src/lib/download.ts`: browser text-file download helper used for embedded wallet key export
- `src/lib/authors.ts`: ENS-backed report-author display helper with a fail-open timeout
- `src/lib/reportDisplay.ts`: title/target display fallbacks from BugBundle public metadata plus onchain fields
- `src/lib/rpcReadCache.ts`: shared browser Base RPC read cache, serialized read queue, and exponential rate-limit cooldown
- `src/lib/logger.ts`: namespaced browser console logging helper for click/auth/debug breadcrumbs
- `src/views/about.ts`: static protocol explainer route for lifecycle, contract mechanics, tech stack, and tokenomics
- `src/views/profile.ts`: public author profile route for ENS avatar/name, BUGZ balance, and recent submissions
- `src/views/manage.ts`: owner-gated contract-suite management route
- `src/views/stake.ts`: connected-wallet BUGZ bonding and delayed-withdrawal route
- `src/views/treasury.ts`: public treasury route for funding address, treasury value, and BUGZ/USD payout range
- `src/xmtp/browser.ts`: browser XMTP SDK adapter for local/external wallet signers
- `src/xmtp/broker.ts`: structured broker submission and detail-unlock XMTP DM helpers
- `src/storage/gateway.ts`: static IPFS gateway reader and disabled-upload fallback
- `src/storage/pinata.ts`: presigned-upload Pinata adapter
- `src/attest/eas.ts`: EAS write adapter for verdicts and payout placeholders
- `src/lib/reports.ts`: submission, loading, decryption, and review orchestration
- `src/config/env.ts`: env parsing and defaults
- `src/config/chains.ts`: chain isolation, currently Base-oriented
- `FEATURES.md`: living feature map with stability, properties, milestones, and test criteria
- `SECURITY.md`: living security model, trust boundaries, implemented guarantees, and planned claims
- `run-broker.sh`: root broker launcher that loads `.env`, validates required XMTP/Base/Bugz variables, optionally enables Signal when `BROKER_SIGNAL_CLI` is set, prepares a `.venv-broker*` virtualenv, initializes SQLite, and runs `scripts/broker-bot.py`
- `scripts/broker-bot.py`: Python XMTP-to-Signal broker runner
- `bots/cheapbugs_broker/`: broker command parsing, SQLite store, optional Signal CLI, and BUGZ payout adapters
- `bots/cheapbugs_broker/bug_index.py`: broker-side `CheapBugsBugIndex.publishBug` adapter and call-shaping helper for accepted BugBundles
- `bots/cheapbugs_broker/treasury.py`: broker-side treasury verifier for detail-key unlock payments

## Project Conventions

- Keep the app deployable as static assets. Do not introduce SSR or a backend database.
- Keep Pinata credentials out of the browser. Use only presigned upload URLs if Pinata is enabled.
- Treat all IPFS content and EAS note content as untrusted user input.
- Never upload sensitive bug details publicly in plaintext.
- Public report metadata is onchain. Private dossier material must be encrypted before upload.
- Use small, testable modules and keep vendor-specific logic behind adapters.
- Chain-specific values must stay isolated in config modules.

## Current Implementation Notes

- Base mainnet is the default chain configuration.
- Direct browser-to-index report writes are disabled. The index accepts broker-published reports only through `publishBug` with a reporter EIP-712 signature.
- The CheapBugs Solidity contract suite is expected to keep precise NatSpec on externally visible APIs, events, errors, structs, public storage getters, and `@dev` comments for non-obvious internal ledgers/helpers.
- EAS is currently used for `ReviewVerdict` and a `PayoutRecord` placeholder only. Do not re-add `@ethereum-attestation-service/eas-sdk`; it pulls Hardhat-era dependencies into npm audit. `src/attest/eas.ts` uses direct ethers contract calls against EAS and SchemaRegistry.
- The bug index contract now includes broker/admin registries, reporter-signed publishing, SHA-256 details-key reveal, bonded up/down votes, and ordered payout completion through `CheapBugsTreasuryVault`. The current frontend review state still comes from EAS until UI/broker wiring moves to the new onchain paths.
- The verified Base contract suite is `CheapBugsBugIndex` `0x515FDbc9876aC26870794E26605c7DD04c18679b`, `CheapBugsBondVault` `0x2Eab99B6d6F1FBDa4fa78a00662E0cf9aBd9f3d3`, and `CheapBugsTreasuryVault` `0x4A080668d9848928dc6D48921cbDc4273fe27A9d`. The frontend defaults to all three addresses in `src/config/env.ts`; `VITE_BUGZ_TREASURY_ADDRESS` remains only a legacy treasury-vault display alias.
- BUGZ is live on Base at `0x60Df4a0C9A5050c337010cb29C9694cE4d8fbb07` and is the default `VITE_BUGZ_TOKEN_ADDRESS`. The contract suite hardcodes this BUGZ address; do not reintroduce a repo-managed BUGZ token deployment path.
- The `/token` route reads connected-wallet BUGZ balances and performs static, browser-signed buy/sell swaps through the Uniswap v4 Quoter and Universal Router 2.1.1 on Base. Do not replace this with a backend buy-flow.
- The frontend nav is now `index`, `submit`, `review`, `bond`, `treasury`, `token`, `patrons`, then `about`, with `manage` appearing before `about` only for wallets that own at least one CheapBugs contract. The `bond` nav item routes to `/stake` for compatibility. Header login/session controls stay compact in the top-right header block. Do not re-add the old chain/storage/wallet/SIWE debug block to the header.
- Mobile shell/nav styling lives in `src/styles.css`: below 760px, the header stacks, auth controls go full width, and `.nav-row` becomes a two-column grid of equal-width buttons. Keep nav labels short enough for 320px-wide phones.
- The header brand row includes a compact orange GitHub icon link to `https://github.com/pierce403/cheapbugs` immediately to the right of the `cheapbugs` wordmark, followed by build metadata from `src/buildInfo.ts`. The build timestamp is injected as ISO and formatted in the viewer's local timezone.
- `vite.config.ts` honors `VITE_BUILD_ID` and `VITE_BUILD_TIME` from both `.env` files and `process.env`; Playwright starts Vite with `--force` to avoid stale dev-server transforms for build metadata.
- Reviewer trust is frontend-enforced through an allowlist in config. This is an MVP choice and should be replaceable later.
- The launcher scripts refresh their frontend ABI files after compilation so the app stays aligned with deployed contract shapes. Real contract-suite deployments verify all three contracts on Etherscan/BaseScan by default; set `ETHERSCAN_API_KEY` or `BASESCAN_API_KEY`, and use `BUG_INDEX_VERIFY_CONTRACTS=0` only for intentional unverified deploys.
- The Node launcher records reproducibility data under `deployments/base-8453/`: latest and address-specific manifests plus full generated contract artifacts. These files are intentionally tracked and include compiler/tool versions, optimizer settings, constructor args, transaction logs for broadcasts, verification inputs, and generated ABI/bytecode artifacts. They must not include private keys, explorer API keys, or unredacted RPC URLs.
- Contract-suite launchers use `BUG_INDEX_DEPLOYER_PRIVATE_KEY` when set, otherwise fall back to `BROKER_KEY`. When `BROKER_KEY` is the deployer and `BUG_INDEX_INITIAL_BROKERS` is empty, the broker wallet is seeded as an initial broker. Default final ownership transfers to `0x7ab874Eeef0169ADA0d225E9801A3FfFfa26aAC3`.
- The JS launchers use `forge build` plus Foundry artifacts from `out/...` instead of npm `solc`; keep npm `solc` out of `package.json` unless its audit footprint has been reviewed.
- Foundry is now configured with `contracts/` as the source directory, `script/` for deploy scripts, and `test/` for scenario coverage.
- `forge-std` is tracked as the `lib/forge-std` git submodule, so fresh clones need `git submodule update --init --recursive` before `forge build` or `forge test`.
- The BUGZ patrons leaderboard prefers the Etherscan V2 `tokenholderlist` API when `VITE_ETHERSCAN_API_KEY` or `VITE_BASESCAN_API_KEY` is configured, falls back to 10,000-block Transfer-log pages from `VITE_BUGZ_TOKEN_DEPLOYMENT_BLOCK`, and caches holder snapshots in localStorage for 24 hours. Treasury stats use the committed Base treasury vault by default; `VITE_BUGZ_TREASURY_ADDRESS` only overrides that address.
- The home page no longer renders a patrons preview; keep BUGZ holder scans isolated to `/patrons`.
- Home/index bug-listing tables use a fixed `<colgroup>` in `src/views/home.ts` plus `.bug-listing-table` widths in `src/styles.css`; keep author/date/unlock nowrap so long titles take the flexible width without collapsing metadata columns.
- Header BUGZ status should call `loadBugzHeaderBalance`, not `loadTokenDashboard`; ordinary route chrome must only read connected wallet BUGZ balance and avoid treasury/token metadata dashboard reads.
- Base RPC contract adapters use `src/lib/rpcReadCache.ts` for short success caching, in-flight deduplication, a shared serialized read queue, and exponential global cooldown after 429/rate-limit errors. Wrap new public Base reads in `scheduleBaseRpcRead(...)` instead of issuing parallel `Promise.all` RPC bursts.
- The `/manage` route uses `src/contracts/cheapbugsSuite.ts` to read `owner()` across the suite and expose owner actions for index brokers/admins/vault wiring, treasury broker/index/divisor wiring, bond slasher/treasury wiring, and ownership transfers. `renounceOwnership` is intentionally not exposed in the browser UI.
- `/manage` remains owner-only. Index admins are a separate role; the `/review` route reads `CheapBugsBugIndex.admins(account)` and shows a compact date/title/author/details/admin-flag table without contract-address or schema-catalog chrome. The admin flag dropdown displays `pending` for unreviewed reports and can set `valid`, `invalid`, or `spam` through `flagBug`; the local pending-only checkbox filters the queue to unreviewed reports.
- The `/stake` route is labeled `bond` in the UI. It uses `src/contracts/bondVault.ts` and shows active bond, pending withdrawal, wallet BUGZ, allowance, level, next-level threshold, and a live countdown for delayed withdrawal step 2 without showing raw contract addresses. The add-bond form has one primary button: `approve bugz` when the entered amount exceeds current allowance, otherwise `bond bugz`. Keep copy clear that pending withdrawals remain slashable and new bonds cancel pending withdrawals.
- `src/views/stake.ts` stores a session-only `cheapbugs.bondWithdrawalHint.v1:<vault>:<account>` after a confirmed withdrawal request so a stale immediate `accountOf` read does not hide the pending withdrawal countdown. Chain reads remain authoritative; clear the hint after successful bond or withdraw actions and once `accountOf` returns nonzero pending withdrawal.
- The `/treasury` route uses `src/lib/treasury.ts`, `src/contracts/treasuryVault.ts`, `src/contracts/priceFeeds.ts`, and the existing BUGZ Uniswap v4 quote path to show treasury BUGZ, estimated USD value, and `calculateRewardAmount(1)` through `calculateRewardAmount(10)` as the per-bug range. It renders cached or placeholder data first, then fills values in a throttled background refresh. USD estimates default to Chainlink Base ETH/USD feed `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70`; if the quote/feed fails, keep BUGZ values visible with an informative warning.
- `tests/manage-stake.spec.ts` mocks Base RPC for owner checks, role snapshots, and bond-vault account state.
- `tests/treasury.spec.ts` mocks Base RPC for BUGZ metadata, treasury balance, treasury reward math, Uniswap v4 quotes, and Chainlink ETH/USD reads.
- `tests/recent-reports.spec.ts` mocks Base JSON-RPC, IPFS BugBundle public metadata, ENS, and BUGZ balance reads to verify that index `latestReportHashes` plus `getReport` results render in the home route's `[ recent reports ]` table with score/title/author/date/unlock columns, cache across route changes and reloads, survive 429s from Base/IPFS using stale localStorage, open the detail-unlock modal from locked rows, and link to the author profile route.
- `tests/report-detail.spec.ts` mocks Base JSON-RPC, IPFS BugBundle public metadata, ENS, and EAS GraphQL to verify the individual report route hides raw contract-suite addresses, uses `unlock details` copy, and renders latest EAS verdict rows with trusted/untrusted state.
- `tests/header-bugz.spec.ts` verifies connected header BUGZ status does not issue treasury native balance reads on ordinary routes.
- GitHub Pages deployment uses a GitHub Actions workflow, root-relative Vite base paths for the `cheapbugs.net` custom domain, and hash routing for SPA compatibility.
- GitHub Pages should stay on the GitHub Actions workflow source, not legacy branch publishing.
- Only set `VITE_BASE_PATH` when deploying under a non-root subpath. For the production Pages custom domain, it must stay `/`.
- The header login button opens a CheapBugs wallet onboarding modal before any no-installed-wallet WalletConnect QR path. The modal offers `connect with WalletConnect` and `I don't have a crypto wallet`; the no-wallet path can generate or import an embedded CheapBugs wallet.
- Embedded CheapBugs wallets are stored under `cheapbugs.localXmtpIdentity.v1`, can be imported/exported as `cheapbugs-key.json`, and are used for Base smart-contract transactions, `PublishBug` signing, and XMTP identity when active. Treat the exported JSON as private key material.
- `src/auth/thirdweb.ts` still prompts a Thirdweb installed-wallet SIWE first when an injected provider exists, then falls back to Thirdweb WalletConnect QR when browser login fails.
- Thirdweb auto-connect restores external wallet sessions after refresh. External wallet reconnect hints are stored locally in `cheapbugs.walletSession.v1`; SIWE proofs are stored in `cheapbugs.siweSession.v1` and restored without re-prompting when the wallet/domain/chain still match.
- Headless Thirdweb `wallet.connect()` does not populate the manager keys that `autoConnect()` reads, so `src/auth/thirdweb.ts` deliberately writes the compatible `thirdweb:connected-wallet-ids`, `thirdweb:active-wallet-id`, `thirdweb:last-used-wallet-id`, and `thirdweb:active-chain` localStorage keys after successful external-wallet login.
- Thirdweb wallet login uses `VITE_THIRDWEB_CLIENT_ID`; a public default client id is committed in `src/config/env.ts` for static deploys. Keep the root `thirdweb` dependency pinned to `5.119.4` unless deliberately testing a newer SDK, because `5.120.0` triggered npm peer-resolution conflicts in this repo.
- Browser console logging through `appLog` is intentionally verbose around auth clicks, Thirdweb provider selection, WalletConnect fallback, SIWE prompts, session restore, and failures so users can inspect what login is doing.
- Thirdweb was removed in `f7b7bca` and restored afterward; compare against `f7b7bca^` when looking for the last pre-direct-WalletConnect implementation.
- Connected wallet UI resolves ENS name/avatar from Ethereum mainnet. The header avatar opens a profile modal; report author links route to `/profile/:address`. Editing/registering profile data should route users to the official ENS App instead of creating a local CheapBugs profile store.
- ENS profile lookups cache resolved and missing profiles for 24 hours in `cheapbugs.ensProfileCache.v1` and keep a same-session memory cache in `src/lib/ens.ts`; the profile modal has a refresh button that bypasses the cache.
- ENS avatars are read from the raw `avatar` text record with `ensClient.getEnsText({ key: "avatar" })`, then sanitized to HTTPS or an IPFS gateway URL with paths preserved. Do not switch this back to `getEnsAvatar`; viem's avatar parser HEAD-probes image URLs and can hide otherwise valid avatars when hosts reject HEAD/CORS.
- Link previews use static OpenGraph/Twitter metadata in `index.html` with `https://cheapbugs.net/og-image.png`; current card copy is "report bugs, get paid" and "shitty bugs, competitive prices". Favicon and app icons are served from `public/`.
- The site-wide development banner is rendered from `src/app.ts`; keep launch-date copy centralized there instead of duplicating it in route views. Its visual treatment should stay orange/warning-toned, not green/success-toned.
- The submit route defaults to XMTP DM submission through broker wallet `0xea6995fc3674e1e94736766f5eeefb0506e4ef32`; `VITE_BROKER_XMTP_ADDRESS` overrides that broker. The browser uses `@xmtp/browser-sdk` with the embedded CheapBugs wallet (`cheapbugs.localXmtpIdentity.v1`) or an external wallet signer.
- Browser-to-broker bug submissions use strict JSON schema `cheapbugs.bug_submission.v1` from `src/xmtp/broker.ts`; the current submit form collects title, target reference, bug type (`0day`, `nday`, `web`, `web3`, `net`, `intel`), severity, target interest, public summary, and private details. The browser writes the target reference into the BugBundle target with kind `other`, generates the details key, encrypts details into `cheapbugs.bug_bundle.v1`, signs a `PublishBug` EIP-712 authorization over the bundle hash and commitments, and sends the bundle, `publish_authorization`, and out-of-bundle `details_key` to the broker over XMTP. Do not re-add repro/evidence/Signal/target kind/tags/review-access-key fields unless the product direction changes.
- Frontend text validation should stay aligned with `bots/cheapbugs_broker/commands.py`: title 3-120 characters, target reference 2-160 characters in the browser, public summary 10-2,000 characters, and private details 10-12,000 characters after trimming. `src/types/submission.ts` owns the frontend constants and validator.
- The bug-index contract does not store a separate title or target-reference string. The frontend reads title and human-readable target from the public core of the pinned BugBundle via `loadPublicBugBundleMetadata`, validates the shape, escapes rendered text, and falls back to onchain report id/target kind when IPFS is unavailable or malformed.
- Optional public display reads should fail open: `src/contracts/bugIndex.ts` wraps bug-index reads in a short timeout, and BugBundle metadata/author ENS helpers also have timeouts so the shell and archive tables are not blocked by public RPC/gateway slowness.
- `src/contracts/bugIndex.ts` persists public `latestReportHashes`/`getReport` results in `cheapbugs.bugIndex.v2`, and `src/lib/ipfs.ts` persists full encrypted BugBundle JSON in `cheapbugs.ipfs` for 30 days with stale fallback on 429s. Do not cache decrypted private details or unrevealed details keys in localStorage.
- Browser-built BugBundles sign `revealAfter` as 7 days plus a 1-hour publish buffer after bundle creation. The index checks the 7-day minimum against the onchain publish block, so signing exactly 7 days out causes `InvalidRevealAfter(uint64)` as soon as broker processing takes nonzero time.
- Browser-to-broker submissions now have broker-verified `CheapBugsBugIndex.publishBug` EIP-712 relay signatures, and the Python broker submits accepted, IPFS-pinned BugBundles to the index when `BROKER_DRY_RUN=0`.
- `bots/cheapbugs_broker/bugbundle.py` verifies submitter-built bundles before IPFS pinning: schema, field binding, reporter/broker/chain/index binding, EIP-712 signature recovery, details key commitment, encrypted details hash, AAD, and decryption. `bots/cheapbugs_broker/ipfs.py` pins the verified bundle payload through local Kubo without adding broker status fields. Keep plaintext details out of pinned IPFS JSON.
- `CheapBugsBugIndex.publishBug` verifies the reporter EIP-712 signature onchain over hash commitments, not over the broker-produced IPFS CID. The browser signs a SHA-256 `bugBundleHash` of canonical `BugBundle.core`; that core includes bug type, severity, target interest, title, public summary, target, disclosure mode, tags, encrypted-details hash, and details-key commitment. Base RPC publish/gas-estimate calldata must contain only public-safe fields, the CID, commitments, reveal timing, nonce/deadline, and signature; never send private details plaintext, ciphertext, or the out-of-bundle details key to the index RPC.
- The submit route has an inline `#xmtp-status` indicator for XMTP wallet readiness, registration-signature progress, PublishBug authorization progress, success, and failure. During external-wallet signature waits it also shows `#xmtp-signature-modal` so WalletConnect/mobile approvals are visible. Keep `submit to broker` clickable while disconnected so it can show the wallet-required status instead of doing nothing.
- During broker submission progress, the submit route shows `#xmtp-processing-modal` with the latest XMTP or broker status message, treats `Encrypted BugBundle pinned to IPFS: ipfs://...` as progress, keeps it open until a `Submission complete: Bug published onchain...`, `Bug already exists onchain...`, or `Bug index dry-run complete...` broker reply, then switches the modal into a closeable completed state.
- Browser XMTP registration can require a wallet signature before any broker message is sent. `src/xmtp/browser.ts` caches identical signature requests, skips redundant registration when the SDK reports the installation is already registered, and checks broker inboxes with both stripped and `0x` Ethereum identifier forms.
- The Python parser rejects text `!submit` messages, missing core fields, unexpected fields, and invalid provided target references.
- The broker has three website-initiated JSON-over-XMTP flows: publisher for bug submission/publishing, seller/detail-unlock for paid early access to unrevealed details keys, and bouncer for special Signal group access requests.
- Detail unlocks use strict JSON schema `cheapbugs.detail_unlock.v1` in `src/xmtp/broker.ts` and `bots/cheapbugs_broker/commands.py`. The browser asks for a quote, approves/pays `CheapBugsTreasuryVault.purchaseDetailKey(reportHash, amount)`, sends the tx hash back, then stores the returned details key in the existing per-report access-key localStorage path.
- BUGZ detail-key payments can revert from the token with `ERC20InsufficientAllowance(address,uint256,uint256)` selector `0xfb8f41b2`; keep the treasury frontend ABI/error mapper aware of ERC20 custom errors so users see an approval/balance action instead of an unknown ABI selector.
- Broker detail-unlock verification must treat the buyer as adversarial: bind `buyer_address` to the authenticated XMTP sender, verify broker/index/treasury/chain config, use the SQLite quote by request id, verify the transaction sender/recipient/status, and require `detailKeyPayments(reportHash,buyer) >= stored_quote.price_wei` before sending the key. Do not trust buyer-supplied prices or amounts.
- `bots/cheapbugs_broker/xmtp_runner.py` passes `ctx.get_sender_address()` into `BrokerBot.handle_xmtp_text`. The bouncer/access path treats that authenticated XMTP sender as the only wallet identity; optional `wallet` fields must match it and are rejected before BUGZ balance checks or Signal invites if they differ.
- Broker submission records must use the verified PublishBug reporter. `bots/cheapbugs_broker/service.py` rejects submissions when the verified EIP-712 reporter differs from `reporter_address`, or when an available authenticated XMTP sender differs from that verified reporter, before credentials, IPFS pinning, index publication, Signal relay, or payout persistence.
- Signal relay formatting in `bots/cheapbugs_broker/service.py` should stay compact: include the heading, summary, details, and BugBundle URI, but do not re-add empty repro/evidence/contact-hint placeholder sections.
- The broker sends plain text XMTP status messages after each successful submission validation stage: JSON valid, fields well formed, publish authorization/details valid, target valid, credentials valid. Submission credentials use `BROKER_REPUTATION_BLOCKLIST`; `BROKER_SUBMISSION_MIN_BUGZ` defaults to `0` for open submissions and can be raised later to require a BUGZ balance.
- Unrecognized incoming XMTP text or JSON flow types should get a plain `hello.` reply and be marked processed so other clients can confirm the bot is active. Recognized but malformed submission/access flows should still return their specific validation errors.
- Broker XMTP status messages intentionally use `ctx.send_text` instead of `ctx.send_text_reply`; keep the broker flow independent of nonessential reply-content codec behavior unless live testing proves the reply path is needed and stable.
- The XMTP browser SDK needs the Vite alias and `scripts/fix-xmtp-wasm-worker.mjs` shim for the sqlite worker file, matching the working pattern from `../converge.cv`.
- The Python broker uses `xmtp==0.1.5` and `xmtp-bindings==0.1.5`, plus `signal-cli`, SQLite, and `web3.py`. Use `python3 -m unittest discover -s bots/tests -t bots` for bot tests.
- Check the real runtime with `.venv-broker/bin/python -m pip show xmtp xmtp-bindings xmtp-agent` before assuming the pin is installed. `xmtp-bindings` bundles the native libxmtp build; inspect `.venv-broker/lib/python*/site-packages/xmtp_bindings/libxmtp.ref` for the bundled ref.
- `bots/cheapbugs_broker/xmtp_runner.py` keeps guarded native compatibility shims for accidental `xmtp-bindings` drift that changes `connect_to_backend`, `create_client`, `register_identity`, or `FfiSubscribeError`; the exact `0.1.5`/`0.1.5` pair does not need those shims at runtime.
- The broker starts XMTP through `create_xmtp_agent_with_recovery`, which disables auto-register until it can inspect persisted installation state. It archives inbox-mismatched `BROKER_XMTP_DB_PATH` files to `archive/*.bak`, retries with a fresh DB, proactively revokes stale installations at the limit, and by default prunes all other broker installations after registration. If logs show `is_active=False` or `local XMTP installation is missing from network inbox state`, the local XMTP DB is stale and startup should archive/recreate it unless `BROKER_XMTP_ARCHIVE_INACTIVE_DB=0` is set. Set `BROKER_XMTP_AUTO_REVOKE_OLD_INSTALLATIONS=0` only if intentionally running multiple broker installations for the same key.
- `bots/cheapbugs_broker/xmtp_runner.py` also patches `xmtp_agent.Agent._stop_streams` to avoid cancelling the current stream task, which can recurse in Python 3.12 `Task.cancel()` after stream errors.
- Use `./run-broker.sh` for local broker runtime startup. It expects a shell-compatible `.env`, defaults `BROKER_DRY_RUN=1`, requires only `BROKER_KEY` for the no-Signal path, and creates `.venv-broker*`/`.broker`, which are gitignored. Base RPC defaults to `https://mainnet.base.org`; BUGZ token and bug-index addresses default to the live Base deployment. If `BROKER_SIGNAL_CLI` is unset, Signal relay/reaction/reward support is disabled with a warning.
- Broker `run` startup expects a local Kubo IPFS API at `BROKER_IPFS_API_URL`, defaulting to `http://127.0.0.1:5001`; it checks `/api/v0/version` and a tiny unpinned `/api/v0/add` probe before listening to XMTP.
- `BROKER_IPFS_GATEWAY_URL` defaults to `https://ipfs.io/ipfs`. `BROKER_IPFS_PRIME_GATEWAY=1` does best-effort gateway priming after add, but this is not durable pinning and may fail if the local Kubo node is not reachable through the IPFS swarm.
- After IPFS pinning, `bots/cheapbugs_broker/bug_index.py` checks `brokers(BROKER_KEY address)`, gas estimates `publishBug`, checks native Base ETH balance, broadcasts the transaction, waits up to `BROKER_TX_RECEIPT_TIMEOUT_SECONDS` seconds, and records `report_hash`/`index_tx_hash` in SQLite. `BROKER_DRY_RUN=1` skips the transaction and Signal relay.
- In live mode, `bots/cheapbugs_broker/service.py` preflights the signed reveal window before IPFS pinning. `bots/cheapbugs_broker/bug_index.py` also decodes index custom-error selectors such as `InvalidRevealAfter`, `RevealNotReady`, and `SignatureExpired` into timestamped broker errors.
- Broker-side signature and bundle checks compare normalized lowercase EVM addresses, but web3.py contract calls must receive checksum addresses for ABI `address` fields. Keep checksum conversion at the `bots/cheapbugs_broker/bug_index.py` RPC boundary.
- The new index publish path stores the details-key commitment as SHA-256 of the raw 32-byte details key. Brokers should reveal the raw `bytes32` key onchain, not the base64url string sent through current XMTP messages.
- `CheapBugsBondVault.getLevel(address)` returns `floor(log10(active whole BUGZ))`; pending withdrawals do not count toward voting level. Users below level 1 have no nonzero onchain vote weight.
- The home/index route renders bonded vote controls from `src/views/home.ts` and `src/contracts/bugIndex.ts`: vote totals are loaded with Multicall3 when possible, connected-user direction is highlighted from `getBondVote`, and level-0 click attempts use the bond vault `accountOf` preflight before showing the bond-required modal. The same route opens shared detail-unlock purchase handling from `src/views/detailUnlock.ts` when a locked row's lock icon is clicked.
- Index payout completion is ordered by report insertion. The broker calls `CheapBugsBugIndex.completePayout`, which reveals the key if needed and calls `CheapBugsTreasuryVault.payRewardFromIndex`; do not bypass the index by paying directly from the treasury.
- `test/CheapBugsLivePayoutFork.t.sol` is an opt-in Base fork payout rehearsal. Run `CHEAPBUGS_LIVE_PAYOUT_FORK=1 forge test --match-contract CheapBugsLivePayoutForkTest -vvv` to diagnose live index/treasury wiring and payout blockers. To simulate full ordered payouts from a fork snapshot, set `CHEAPBUGS_LIVE_PAYOUT_DETAIL_KEYS` to comma-delimited raw `bytes32` details keys in current payout order; optional `CHEAPBUGS_LIVE_PAYOUT_STATUSES` uses `1=Valid,2=Invalid,3=Spam`, and optional `CHEAPBUGS_LIVE_PAYOUT_MULTIPLIERS` uses `0..10`.
- `run-broker.sh` prefers `python3.13`, `python3.12`, `python3.11`, then `python3.10` before generic `python3` so `xmtp-bindings` can use published wheels instead of forcing a Rust source build. Set `BROKER_PYTHON` or `BROKER_VENV_DIR` to override.
- Broker runtime logs go to stdout and `BROKER_LOG_PATH`, defaulting to `broker.log`, with timestamps. New broker submissions intentionally log a clear `NEW SUBMISSION from <reporter>` line and the full raw XMTP JSON payload, including the out-of-bundle details key, so treat broker logs as private disclosure material.
- Use `./run-broker.sh debug` for XMTP broker crash debugging; it turns on Python DEBUG logs, `PYTHONFAULTHANDLER=1`, `RUST_BACKTRACE=full`, `RUST_LOG=debug`, and defaults to `broker-debug.log`.
- The current Python broker reward adapter still sends direct ERC20 transfers from the wallet behind `BROKER_KEY`; the new contract architecture should move live rewards to index-ordered `CheapBugsTreasuryVault` payouts before production use.

## Known Issues And Practical Tips

- `npm run build` currently succeeds but emits large-chunk warnings because of the WalletConnect/XMTP dependency graph.
- GitHub Actions run pages show top-level status and annotations publicly, but step logs require GitHub sign-in.
- ENS avatar URLs are untrusted input. Only render sanitized HTTPS URLs or a local fallback badge.
- Embedded CheapBugs wallet keys are browser-stored recovery material. Users must export and secure `cheapbugs-key.json` before relying on that wallet for BUGZ rewards.
- Embedded CheapBugs wallets can sign contract transactions and BUGZ trades from the browser via their stored private key; they still need Base ETH for gas and buys.
- BUGZ trading is Base-only and uses the Clanker-created Uniswap v4 WETH/BUGZ pool key configured in `src/config/env.ts`. Buys wrap ETH in Universal Router; sells require Permit2 approval before the router can pull BUGZ.
- BUGZ buy/sell must not depend on `VITE_BUGZ_TREASURY_ADDRESS`; if a token read returns `missing revert data`, first check that the configured RPC is Base mainnet.
- The header BUGZ status starts as `bugz: loading` for connected wallets, then renders the balance or `bugz: unavailable`. Header token reads log loud console errors under `[cheapbugs] token: header BUGZ status load ...` when balance loading fails, with RPC/token context. Check `/token` and the browser console for the actual balance-read failure reason.
- Base ethers read providers come from `src/contracts/rpcProvider.ts` with JSON-RPC batching disabled (`batchMaxCount: 1`), `staticNetwork: true`, an 8s timeout, and ethers HTTP 429 retries disabled through `FetchRequest.retryFunc`. Keep this for public Base RPC compatibility; the default ethers batch size/retry behavior can flood public endpoints during concurrent header/token reads.
- Browser Base read caches use a shared rate-limit cooldown in `src/lib/rpcReadCache.ts`; preserve that cross-adapter backoff when adding new contract adapters. The bond dashboard also avoids `getLevel`/`WITHDRAWAL_DELAY` reads by computing display level from `accountOf` and using the fixed 7-day delay.
- The live BUGZ v4 pool was validated from Clanker `TokenCreated` block `46093316`: hook `0xb429d62f8f3bFFb98CdB9569533eA23bF0Ba28CC`, pool id `0x4c360c12ee8063e7170c344eba74f28ab0d3879c797ed46269202c3966234657`, dynamic fee flag `8388608`, tick spacing `200`, paired WETH.
- The default BUGZ holder scan starts from Base block `46093316`; if the holder API is not configured, expect `patrons` to issue chunked 10,000-block `eth_getLogs` reads and rely on the 24-hour localStorage cache. If a public RPC refuses the scan, the UI should point users at the Etherscan API key dashboard and `tokenholderlist` docs instead of showing raw ethers errors.
- `ffmpeg` is available in the local environment and was used to derive favicon/OpenGraph PNG assets from `cheapbugs.png`.
- Signal reactions are social support signals only; they are not sybil-resistant votes.
- Real onchain submission requires `VITE_BUG_INDEX_ADDRESS` to be set.
- Real XMTP submission requires the default or overridden broker address to point at an already registered broker XMTP inbox.
- Real verdict writes require `VITE_REVIEW_VERDICT_SCHEMA_UID` to be set.
- The bug-index launcher deploys the full CheapBugs contract suite and needs `BUG_INDEX_DEPLOYER_PRIVATE_KEY` or `BROKER_KEY`, plus `ETHERSCAN_API_KEY` or `BASESCAN_API_KEY` for a default real deployment. Optional initial lists are `BUG_INDEX_INITIAL_BROKERS`, `BUG_INDEX_INITIAL_ADMINS`, and `BUG_INDEX_INITIAL_SLASHERS`. If the default Base RPC rate-limits post-deploy reads after transactions have already broadcast, do not rerun deployment blindly; recover by reading the deployed addresses through another Base RPC, verifying with `forge verify-contract`, and recording the address-specific manifest.
- `artifacts/`, `out/`, `cache/`, `broadcast/`, and `dist/` are generated outputs and should not be committed unless the user explicitly asks. `deployments/` is the exception for committed contract-suite reproducibility records.

## Collaborator Preferences

- Keep communication direct and concise.
- Prefer implementation over long planning when the task is actionable.
- Add tests for each feature you implement; Playwright is preferred for browser-facing behavior.
- Maintain clean extension points for future product areas instead of premature feature sprawl.
- Commit and push after each completed task, before the final response.

## Update Guidance

When updating this file, keep it compact and high-signal. Replace stale guidance instead of only appending new notes.

When feature behavior or architecture changes, do not leave `FEATURES.md` stale. Treat it as a living feature and system map for future agents.
