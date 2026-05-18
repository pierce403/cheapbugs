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
- auth and wallet connectivity use Thirdweb wallets with injected browser wallet and WalletConnect QR support

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
- `src/contracts/bugIndex.ts`: frontend read/write adapter for the bug index contract
- `src/contracts/bugzToken.ts`: read-only BUGZ adapter for metadata, connected-wallet balances, optional treasury stats, and patron scans
- `src/contracts/bugzTrade.ts`: static frontend Uniswap v4 trade adapter for BUGZ buy/sell on Base
- `src/contracts/bugzTokenAbi.ts`: generated frontend ABI module for the BUGZ token contract
- `src/auth/thirdweb.ts`: Thirdweb wallet, WalletConnect QR, local SIWE proof, and signer adapter
- `src/app.ts`: site shell, top-level navigation, session chrome, and site-wide development banner
- `src/auth/localIdentity.ts`: browser-stored generated XMTP wallet identity helper
- `src/lib/logger.ts`: namespaced browser console logging helper for click/auth/debug breadcrumbs
- `src/xmtp/browser.ts`: browser XMTP SDK adapter for local/external wallet signers
- `src/xmtp/broker.ts`: structured broker submission DM helper
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
- BUGZ is live on Base at `0x60Df4a0C9A5050c337010cb29C9694cE4d8fbb07` and is the default `VITE_BUGZ_TOKEN_ADDRESS`. The contract suite hardcodes this BUGZ address; do not reintroduce a repo-managed BUGZ token deployment path.
- The `/token` route reads connected-wallet BUGZ balances and performs static, browser-signed buy/sell swaps through the Uniswap v4 Quoter and Universal Router 2.1.1 on Base. Do not replace this with a backend buy-flow.
- The frontend nav is now `index`, `submit`, `review`, `token`, `patrons`, with compact login/session controls in the top-right header block. Do not re-add the old chain/storage/wallet/SIWE debug block to the header.
- The header brand row includes a compact orange GitHub icon link to `https://github.com/pierce403/cheapbugs` immediately to the right of the `cheapbugs` wordmark, followed by build metadata from `src/buildInfo.ts`. The build timestamp is injected as ISO and formatted in the viewer's local timezone.
- Reviewer trust is frontend-enforced through an allowlist in config. This is an MVP choice and should be replaceable later.
- The launcher scripts refresh their frontend ABI files after compilation so the app stays aligned with deployed contract shapes. Real contract-suite deployments verify all three contracts on Etherscan/BaseScan by default; set `ETHERSCAN_API_KEY` or `BASESCAN_API_KEY`, and use `BUG_INDEX_VERIFY_CONTRACTS=0` only for intentional unverified deploys.
- The JS launchers use `forge build` plus Foundry artifacts from `out/...` instead of npm `solc`; keep npm `solc` out of `package.json` unless its audit footprint has been reviewed.
- Foundry is now configured with `contracts/` as the source directory, `script/` for deploy scripts, and `test/` for scenario coverage.
- `forge-std` is tracked as the `lib/forge-std` git submodule, so fresh clones need `git submodule update --init --recursive` before `forge build` or `forge test`.
- The BUGZ patrons leaderboard prefers the Etherscan V2 `tokenholderlist` API when `VITE_ETHERSCAN_API_KEY` or `VITE_BASESCAN_API_KEY` is configured, falls back to 10,000-block Transfer-log pages from `VITE_BUGZ_TOKEN_DEPLOYMENT_BLOCK`, and caches holder snapshots in localStorage for 24 hours. Treasury stats are optional display-only rows and must stay hidden when `VITE_BUGZ_TREASURY_ADDRESS` is unset.
- The home page patron preview is cache-only; do not make the home route trigger fresh holder scans.
- GitHub Pages deployment uses a GitHub Actions workflow, root-relative Vite base paths for the `cheapbugs.net` custom domain, and hash routing for SPA compatibility.
- GitHub Pages should stay on the GitHub Actions workflow source, not legacy branch publishing.
- Only set `VITE_BASE_PATH` when deploying under a non-root subpath. For the production Pages custom domain, it must stay `/`.
- The header login button calls `authController.connectPrimary()` directly instead of routing to `/login`. It prompts a Thirdweb installed-wallet SIWE first, then falls back to Thirdweb WalletConnect QR when browser login fails or no provider exists.
- Thirdweb auto-connect restores external wallet sessions after refresh. External wallet reconnect hints are stored locally in `cheapbugs.walletSession.v1`; SIWE proofs are stored in `cheapbugs.siweSession.v1` and restored without re-prompting when the wallet/domain/chain still match.
- Headless Thirdweb `wallet.connect()` does not populate the manager keys that `autoConnect()` reads, so `src/auth/thirdweb.ts` deliberately writes the compatible `thirdweb:connected-wallet-ids`, `thirdweb:active-wallet-id`, `thirdweb:last-used-wallet-id`, and `thirdweb:active-chain` localStorage keys after successful external-wallet login.
- Thirdweb wallet login uses `VITE_THIRDWEB_CLIENT_ID`; a public default client id is committed in `src/config/env.ts` for static deploys. Keep the root `thirdweb` dependency pinned to `5.119.4` unless deliberately testing a newer SDK, because `5.120.0` triggered npm peer-resolution conflicts in this repo.
- Browser console logging through `appLog` is intentionally verbose around auth clicks, Thirdweb provider selection, WalletConnect fallback, SIWE prompts, session restore, and failures so users can inspect what login is doing.
- Thirdweb was removed in `f7b7bca` and restored afterward; compare against `f7b7bca^` when looking for the last pre-direct-WalletConnect implementation.
- Connected wallet UI resolves ENS name/avatar from Ethereum mainnet. The header avatar opens a profile modal; editing/registering profile data should route users to the official ENS App instead of creating a local CheapBugs profile store.
- ENS profile lookups cache resolved and missing profiles for 24 hours in `cheapbugs.ensProfileCache.v1` and keep a same-session memory cache in `src/lib/ens.ts`; the profile modal has a refresh button that bypasses the cache.
- ENS avatars are read from the raw `avatar` text record with `ensClient.getEnsText({ key: "avatar" })`, then sanitized to HTTPS or an IPFS gateway URL with paths preserved. Do not switch this back to `getEnsAvatar`; viem's avatar parser HEAD-probes image URLs and can hide otherwise valid avatars when hosts reject HEAD/CORS.
- Link previews use static OpenGraph/Twitter metadata in `index.html` with `https://cheapbugs.net/og-image.png`; favicon and app icons are served from `public/`.
- The site-wide development banner is rendered from `src/app.ts`; keep launch-date copy centralized there instead of duplicating it in route views.
- The submit route defaults to XMTP DM submission through broker wallet `0xea6995fc3674e1e94736766f5eeefb0506e4ef32`; `VITE_BROKER_XMTP_ADDRESS` overrides that broker. The browser uses `@xmtp/browser-sdk` with a Converge-style local generated wallet (`cheapbugs.localXmtpIdentity.v1`) or an existing wallet signer.
- Browser-to-broker bug submissions use strict JSON schema `cheapbugs.bug_submission.v1` from `src/xmtp/broker.ts`; the current submit form collects bug type (`0day`, `nday`, `web`, `net`, `intel`), severity, target interest, title, public summary, and private details. The browser generates the details key, encrypts details into `cheapbugs.bug_bundle.v1`, signs a `PublishBug` EIP-712 authorization over the bundle hash and commitments, and sends the bundle, `publish_authorization`, and out-of-bundle `details_key` to the broker over XMTP. Do not re-add repro/evidence/Signal/target kind/reference/tags/review-access-key fields unless the product direction changes.
- Browser-to-broker submissions now have broker-verified `CheapBugsBugIndex.publishBug` EIP-712 relay signatures. The broker still must not create live user-attributed onchain bug-index records until its accepted-submission path submits the verified envelope to the index after IPFS pinning.
- `bots/cheapbugs_broker/bugbundle.py` verifies submitter-built bundles before IPFS pinning: schema, field binding, reporter/broker/chain/index binding, EIP-712 signature recovery, details key commitment, encrypted details hash, AAD, and decryption. `bots/cheapbugs_broker/ipfs.py` pins the verified bundle payload through local Kubo without adding broker status fields. Keep plaintext details out of pinned IPFS JSON.
- The submit route has an inline `#xmtp-status` indicator for XMTP wallet readiness, registration-signature progress, PublishBug authorization progress, success, and failure. During external-wallet signature waits it also shows `#xmtp-signature-modal` so WalletConnect/mobile approvals are visible. Keep `submit to broker` clickable while disconnected so it can show the wallet-required status instead of doing nothing.
- During broker submission progress, the submit route shows `#xmtp-processing-modal` with the latest XMTP or broker status message, keeps it open until the broker confirms `Encrypted BugBundle pinned to IPFS: ipfs://...`, then switches the modal into a closeable completed state.
- Browser XMTP registration can require a wallet signature before any broker message is sent. `src/xmtp/browser.ts` caches identical signature requests, skips redundant registration when the SDK reports the installation is already registered, and checks broker inboxes with both stripped and `0x` Ethereum identifier forms.
- The Python parser rejects text `!submit` messages, missing core fields, unexpected fields, and invalid provided target references.
- The broker has three website-initiated JSON-over-XMTP flows: publisher for bug submission/publishing, seller for planned judging-period preview access requests, and bouncer for special Signal group access requests.
- The broker sends plain text XMTP status messages after each successful submission validation stage: JSON valid, fields well formed, publish authorization/details valid, target valid, credentials valid. Submission credentials use `BROKER_SUBMISSION_MIN_BUGZ` plus `BROKER_REPUTATION_BLOCKLIST`.
- Broker XMTP status messages intentionally use `ctx.send_text` instead of `ctx.send_text_reply`; keep the broker flow independent of nonessential reply-content codec behavior unless live testing proves the reply path is needed and stable.
- The XMTP browser SDK needs the Vite alias and `scripts/fix-xmtp-wasm-worker.mjs` shim for the sqlite worker file, matching the working pattern from `../converge.cv`.
- The Python broker uses `xmtp==0.1.6`, `signal-cli`, SQLite, and `web3.py`. Use `python3 -m unittest discover -s bots/tests -t bots` for bot tests.
- `bots/cheapbugs_broker/xmtp_runner.py` installs temporary `xmtp==0.1.6` native compatibility shims for the old Python wrapper calls to `connect_to_backend`, `create_client`, and `FfiSubscribeError`; keep them until the published Python package and bindings signatures are aligned.
- `bots/cheapbugs_broker/xmtp_runner.py` also patches `xmtp_agent.Agent._stop_streams` to avoid cancelling the current stream task, which can recurse in Python 3.12 `Task.cancel()` after stream errors.
- Use `./run-broker.sh` for local broker runtime startup. It expects a shell-compatible `.env`, defaults `BROKER_DRY_RUN=1`, requires only `BROKER_KEY` for the no-Signal path, and creates `.venv-broker*`/`.broker`, which are gitignored. Base RPC defaults to `https://mainnet.base.org`; BUGZ token defaults to the live Base token. If `BROKER_SIGNAL_CLI` is unset, Signal relay/reaction/reward support is disabled with a warning.
- Broker `run` startup expects a local Kubo IPFS API at `BROKER_IPFS_API_URL`, defaulting to `http://127.0.0.1:5001`; it checks `/api/v0/version` and a tiny unpinned `/api/v0/add` probe before listening to XMTP.
- `BROKER_IPFS_GATEWAY_URL` defaults to `https://ipfs.io/ipfs`. `BROKER_IPFS_PRIME_GATEWAY=1` does best-effort gateway priming after add, but this is not durable pinning and may fail if the local Kubo node is not reachable through the IPFS swarm.
- The new index publish path stores the details-key commitment as SHA-256 of the raw 32-byte details key. Brokers should reveal the raw `bytes32` key onchain, not the base64url string sent through current XMTP messages.
- `CheapBugsBondVault.getLevel(address)` returns `floor(log10(active whole BUGZ))`; pending withdrawals do not count toward voting level. Users below level 1 have no nonzero onchain vote weight.
- Index payout completion is ordered by report insertion. The broker calls `CheapBugsBugIndex.completePayout`, which reveals the key if needed and calls `CheapBugsTreasuryVault.payRewardFromIndex`; do not bypass the index by paying directly from the treasury.
- `run-broker.sh` prefers `python3.13`, `python3.12`, `python3.11`, then `python3.10` before generic `python3` so `xmtp-bindings` can use published wheels instead of forcing a Rust source build. Set `BROKER_PYTHON` or `BROKER_VENV_DIR` to override.
- Broker runtime logs go to stdout and `BROKER_LOG_PATH`, defaulting to `broker.log`, with timestamps. New broker submissions intentionally log a clear `NEW SUBMISSION from <reporter>` line and the full raw XMTP JSON payload, including the out-of-bundle details key, so treat broker logs as private disclosure material.
- Use `./run-broker.sh debug` for XMTP broker crash debugging; it turns on Python DEBUG logs, `PYTHONFAULTHANDLER=1`, `RUST_BACKTRACE=full`, `RUST_LOG=debug`, and defaults to `broker-debug.log`.
- The current Python broker reward adapter still sends direct ERC20 transfers from the wallet behind `BROKER_KEY`; the new contract architecture should move live rewards to index-ordered `CheapBugsTreasuryVault` payouts before production use.

## Known Issues And Practical Tips

- `npm run build` currently succeeds but emits large-chunk warnings because of the WalletConnect/XMTP dependency graph.
- GitHub Actions run pages show top-level status and annotations publicly, but step logs require GitHub sign-in.
- ENS avatar URLs are untrusted input. Only render sanitized HTTPS URLs or a local fallback badge.
- Local XMTP wallet keys are browser-stored recovery material. Users must copy the recovery key before relying on that wallet for BUGZ rewards.
- Local XMTP wallets can also sign BUGZ trade transactions from the browser via their stored private key; they still need Base ETH for gas and buys.
- BUGZ trading is Base-only and uses the Clanker-created Uniswap v4 WETH/BUGZ pool key configured in `src/config/env.ts`. Buys wrap ETH in Universal Router; sells require Permit2 approval before the router can pull BUGZ.
- BUGZ buy/sell must not depend on `VITE_BUGZ_TREASURY_ADDRESS`; if a token read returns `missing revert data`, first check that the configured RPC is Base mainnet.
- The header BUGZ status starts as `bugz: loading` for connected wallets, then renders the balance or `bugz: unavailable`. Header token reads log loud console errors under `[cheapbugs] token: header BUGZ status load ...` when balance loading fails, with RPC/token context. Check `/token` and the browser console for the actual balance-read failure reason.
- Base ethers read providers come from `src/contracts/rpcProvider.ts` with JSON-RPC batching disabled (`batchMaxCount: 1`) and `staticNetwork: true`. Keep this for public Base RPC compatibility; the default ethers batch size can exceed public endpoint limits during concurrent header/token reads.
- The live BUGZ v4 pool was validated from Clanker `TokenCreated` block `46093316`: hook `0xb429d62f8f3bFFb98CdB9569533eA23bF0Ba28CC`, pool id `0x4c360c12ee8063e7170c344eba74f28ab0d3879c797ed46269202c3966234657`, dynamic fee flag `8388608`, tick spacing `200`, paired WETH.
- The default BUGZ holder scan starts from Base block `46093316`; if the holder API is not configured, expect `patrons` to issue chunked 10,000-block `eth_getLogs` reads and rely on the 24-hour localStorage cache. If a public RPC refuses the scan, the UI should point users at the Etherscan API key dashboard and `tokenholderlist` docs instead of showing raw ethers errors.
- `ffmpeg` is available in the local environment and was used to derive favicon/OpenGraph PNG assets from `cheapbugs.png`.
- Signal reactions are social support signals only; they are not sybil-resistant votes.
- Real onchain submission requires `VITE_BUG_INDEX_ADDRESS` to be set.
- Real XMTP submission requires the default or overridden broker address to point at an already registered broker XMTP inbox.
- Real verdict writes require `VITE_REVIEW_VERDICT_SCHEMA_UID` to be set.
- The bug-index launcher deploys the full CheapBugs contract suite and needs `BUG_INDEX_DEPLOYER_PRIVATE_KEY` plus `ETHERSCAN_API_KEY` or `BASESCAN_API_KEY` for a default real deployment. Optional initial lists are `BUG_INDEX_INITIAL_BROKERS`, `BUG_INDEX_INITIAL_ADMINS`, and `BUG_INDEX_INITIAL_SLASHERS`.
- `artifacts/` and `dist/` are generated outputs and should not be committed unless the user explicitly asks.

## Collaborator Preferences

- Keep communication direct and concise.
- Prefer implementation over long planning when the task is actionable.
- Add tests for each feature you implement; Playwright is preferred for browser-facing behavior.
- Maintain clean extension points for future product areas instead of premature feature sprawl.
- Commit and push after each completed task, before the final response.

## Update Guidance

When updating this file, keep it compact and high-signal. Replace stale guidance instead of only appending new notes.

When feature behavior or architecture changes, do not leave `FEATURES.md` stale. Treat it as a living feature and system map for future agents.
