# CheapBugs - Features

This is the living feature map for CheapBugs. It follows the FEATURES.md pattern: each feature declares stability, testable properties, and verification criteria for humans and coding agents.

Update this file whenever feature behavior, system boundaries, deployment assumptions, integrations, or test expectations materially change.

## Project Map

CheapBugs is a static Vite + TypeScript application with Solidity contracts, Node and Foundry deployment scripts, Playwright browser tests, and an optional Python XMTP broker bot.

```text
cheapbugs/
├── bots/                   # Python broker bot package and tests
├── contracts/              # Solidity bug index and BUGZ extension contracts
├── script/                 # Foundry deployment scripts
├── scripts/                # Deployment, XMTP, and maintenance scripts
├── test/                   # Foundry contract tests
├── tests/                  # Playwright browser tests
├── lib/                    # Foundry libraries
├── public/                 # Static assets and SPA hosting helpers
├── src/
│   ├── attest/             # EAS write adapters
│   ├── auth/               # Thirdweb and local XMTP identity helpers
│   ├── config/             # chain, env, reviewer, and integration config
│   ├── contracts/          # frontend contract ABI and adapters
│   ├── lib/                # domain logic, crypto, IPFS, caching, utilities
│   ├── storage/            # storage-provider implementations
│   ├── types/              # domain and integration types
│   ├── xmtp/               # browser XMTP identity and broker DM helpers
│   └── views/              # route-level UI rendering
├── README.md
├── DEPLOY.md
├── TODO.md
├── run-broker.sh
├── AGENTS.md
├── SECURITY.md
└── FEATURES.md
```

## System Boundaries

- The hosted app is static assets from `dist/`; do not add SSR or an app-owned backend database.
- Public-safe report metadata is stored on Base in `CheapBugsBugIndex`.
- Sensitive dossier content must be encrypted in the browser before IPFS upload on the legacy path.
- XMTP broker submissions are private XMTP DMs to the broker and are not encrypted into IPFS by the static app path.
- The planned broker publishing path uses a submitter-signed `BugBundle` JSON file on IPFS, with encrypted details in the bundle and the reveal key kept out of IPFS until the onchain reveal window opens.
- Reviewer verdicts are EAS attestations on Base and are read through EAS GraphQL.
- The Python broker is an optional off-static runtime with SQLite state; it does not change the frontend deployment model.

## Features

### Static Web App Shell

- **Stability**: stable
- **Description**: Vite/TypeScript browser app with routes for `index`, `submit`, `review`, `token`, and `patrons`, a compact header session area, a GitHub icon link, build metadata, and a centralized development banner.
- **Properties**:
  - The first screen is the usable app, not a landing page.
  - Header login/session controls remain compact and do not reintroduce old chain/storage/wallet/SIWE debug rows.
  - Connected-wallet header BUGZ status shows `bugz: loading` before balance reads complete and logs a high-visibility console error if the read resolves unavailable.
  - Header build metadata shows the bundle commit hash and formats build time in the viewer's local timezone.
  - The development banner text is centralized in `src/app.ts`.
- **Test Criteria**:
  - [x] `npm run build` compiles the static app.
  - [x] `npm run test:e2e` covers the development banner, GitHub brand icon, build metadata, and header BUGZ status states.

### Wallet Auth And Local XMTP Identity

- **Stability**: in-progress
- **Description**: Thirdweb wallet login with injected-wallet SIWE, WalletConnect QR fallback, session restore, ENS display, and site-generated local XMTP wallet identities.
- **Properties**:
  - `VITE_THIRDWEB_CLIENT_ID` has a committed public default for static deploys.
  - External wallet reconnect hints are stored in `cheapbugs.walletSession.v1`; SIWE proofs are stored in `cheapbugs.siweSession.v1`.
  - Local XMTP identities are stored in `cheapbugs.localXmtpIdentity.v1` and can sign XMTP messages and Base transactions.
  - ENS avatars are read from the raw `avatar` text record and sanitized to HTTPS or IPFS gateway URLs.
  - ENS profile results cache in `cheapbugs.ensProfileCache.v1` for 24 hours so page reloads do not re-query mainnet ENS, with a profile-modal refresh button for manual cache bypass.
- **Test Criteria**:
  - [x] Playwright covers ENS-backed profile modal behavior, avatar URL handling, local ENS cache reuse, and manual ENS refresh.
  - [x] `npm run build` catches Thirdweb/XMTP integration type drift.

### Onchain Bug Index

- **Stability**: stable
- **Description**: `CheapBugsBugIndex` stores public-safe report metadata and future reviewer vote data on Base.
- **Properties**:
  - Public records include report hash, report id, reporter, created time, disclosure mode, public summary, encrypted payload CID, target kind, target hash, tags, and private content hash.
  - Contract-specific values stay behind `src/config/chains.ts`, `src/config/env.ts`, and `src/contracts/bugIndex.ts`.
  - Launcher scripts refresh frontend ABI files after compilation.
- **Test Criteria**:
  - [x] `npm run contracts:build` compiles Solidity contracts.
  - [x] `npm run contracts:test` covers report submission and reviewer vote scenarios.
  - [x] `npm run launch:bug-index:dry-run` validates the Node launcher.
  - [x] `npm run launch:bug-index:forge:dry-run` validates the Foundry launcher.

### Legacy Encrypted IPFS Submission Path

- **Stability**: in-progress
- **Description**: Browser builds `SubmissionPrivate` and `SubmissionPublic`, encrypts private dossier JSON, uploads it through a storage provider, and files the public record onchain.
- **Properties**:
  - Private dossier content is encrypted before leaving the browser.
  - Pinata credentials never enter browser code; Pinata uploads require presigned URLs.
  - The default IPFS gateway provider can read JSON but cannot upload.
  - All IPFS content is untrusted input.
- **Test Criteria**:
  - [x] `npm run build` type-checks storage and crypto paths.
  - [ ] Add browser coverage for a mocked encrypted submission once the legacy path becomes primary again.

### XMTP Broker Submission

- **Stability**: in-progress
- **Description**: The submit route sends bug submissions as strict JSON XMTP DMs to the default broker wallet `0xea6995fc3674e1e94736766f5eeefb0506e4ef32`.
- **Properties**:
  - `VITE_BROKER_XMTP_ADDRESS` overrides the default broker wallet only when a different broker is needed.
  - The frontend form collects bug type, severity, target interest, title, public summary, and private details. Repro steps, evidence, Signal recipient, contact hints, target kind/reference fields, tags, and review access keys are intentionally not user-facing.
  - Bug type is a malleable broker-triage hint with current values `0day`, `nday`, `web`, `net`, and `intel`.
  - Severity and target interest are malleable broker-triage hints with current slider values `low`, `medium`, `high`, and `critical`.
  - The frontend sends schema `cheapbugs.bug_submission.v1`, version `1`, type `submission`, reporter address, `bug_type`, `severity`, `target_interest`, title, public summary, private details, and client metadata.
  - The frontend does not yet attach a reporter signature over the submission payload; broker-relayed onchain attribution must stay disabled until the reporter-signed relay feature exists.
  - The submit route shows an inline XMTP status indicator for wallet/signing readiness, send progress, success, and failure.
  - The submit route shows a processing-submission modal while broker XMTP submission work is in progress.
  - The submit route opens a wallet-signature waiting modal while an external wallet or WalletConnect device must approve XMTP registration.
  - XMTP submission status persists across incidental app rerenders so wallet registration progress and failures are not hidden by header/session updates.
  - Browser XMTP registration skips redundant registration for already-registered installations and surfaces wallet-signature progress before any broker DM is attempted.
  - The submit button remains clickable when disconnected so the form can explain the missing XMTP wallet instead of appearing inert.
  - The planned BugBundle path has the submitter generate the details key and send it to the broker outside the signed IPFS bundle; do not expose a frontend review access key field on the broker path.
  - The broker rejects malformed JSON, missing required core fields, unexpected fields, invalid bug type or rating values, invalid provided target references, and invalid reporter credentials.
  - The broker sends plain text XMTP status messages after each successful validation stage: JSON valid, fields well formed, target valid, credentials valid.
  - Broker status messages intentionally avoid XMTP reply-content encoding so the submission flow does not depend on nonessential reply-content codec behavior.
  - Submission credential checks use `BROKER_SUBMISSION_MIN_BUGZ` and `BROKER_REPUTATION_BLOCKLIST`.
- **Test Criteria**:
  - [x] Python unit tests cover strict JSON parsing, required fields, target validation, staged status messages, and credential failure.
  - [x] Playwright covers the default broker wallet, inline XMTP status, disconnected submit feedback, and structured XMTP submit UI.
  - [ ] Add reporter-signed payload envelopes before the broker can submit user-attributed records onchain.
  - [ ] End-to-end live XMTP inbox testing is still manual because it requires registered XMTP wallets.

### BugBundle IPFS Reveal Model

- **Stability**: planned, not implemented
- **Description**: A submitted bug will become one versioned `BugBundle` JSON object pinned to IPFS, with public metadata, broker-triage guidance, encrypted details, and the reporter signature in one immutable blob.
- **Properties**:
  - The bundle schema is planned as `cheapbugs.bug_bundle.v1`.
  - The bundle includes public fields such as reporter, broker, chain id, reveal timing, title, public summary, `bug_type`, `severity`, and `target_interest`.
  - The bundle includes the encrypted `details` ciphertext and encryption metadata, but never the details key.
  - The submitter generates the random details key, encrypts the details, signs the bundle commitment, and sends the signed bundle plus the out-of-bundle details key to the broker over XMTP.
  - The broker verifies the signature, verifies the supplied key commitment, decrypts the details for objective well-formedness checks, then pins the signed bundle bytes to IPFS without modification.
  - The bug index stores the bundle CID, bundle/content commitments, reveal time, and details-key commitment.
  - After the 7-day judgment period, the details key is added to the bug index. Browsers can then fetch the bundle from IPFS, read the key from the index, decrypt details locally, and render the bug as ordinary readable content.
- **Test Criteria**:
  - [ ] Browser tests cover bundle construction, details encryption, key commitment generation, and signature prompt state.
  - [ ] Broker tests prove the broker rejects altered bundles, bad signatures, mismatched details keys, and unintelligible decrypted details.
  - [ ] Contract tests prove keys cannot be revealed before the judgment window and revealed keys must match the stored commitment.
  - [ ] Read-path tests cover automatic post-reveal IPFS fetch and browser decryption.

### Reporter-Signed Broker Relay

- **Stability**: planned, not implemented
- **Description**: Let the broker pin private submission material to IPFS and optionally submit EAS or bug-index records without being able to forge reports from other users.
- **Properties**:
  - The browser must create a canonical BugBundle commitment and an EIP-712 signature from the reporter before sending the publish XMTP message.
  - The signed message must bind at least schema, version, reporter, broker wallet, Base chain id, bug-index contract address, bundle/core hash, encrypted details hash, details-key commitment, reveal time, created time, and a nonce or deadline.
  - The broker may verify, pin IPFS, and pay gas, but it must not be able to choose or alter the reporter address or signed bundle content accepted by the registry.
  - `CheapBugsBugIndex` must reject broker-relayed submissions unless the reporter signature recovers to the claimed reporter, or validates through EIP-1271 if contract-wallet support is added.
  - The contract must prevent replay of the same signed submission across brokers, chains, contracts, or duplicate report hashes.
  - XMTP sender identity is useful broker-side evidence, but it is not enough for the smart-contract-level anti-forgery claim.
  - Private plaintext details must never be placed onchain; onchain records should contain public metadata, IPFS CIDs, commitments, content hashes, and post-window details keys only.
- **Test Criteria**:
  - [ ] Contract tests prove a broker cannot submit a forged report for an arbitrary reporter.
  - [ ] Contract tests prove valid reporter signatures are accepted through the broker-relay path.
  - [ ] Contract tests prove wrong broker, wrong chain/contract domain, expired/deadline, and replayed submissions fail.
  - [ ] Browser tests cover the signature prompt and envelope generation.
  - [ ] Broker tests verify signed envelopes before any IPFS, EAS, or bug-index write.

### Python Broker Bot

- **Stability**: in-progress
- **Description**: Optional Python runtime receives website-initiated JSON commands over XMTP, validates broker flows, optionally relays accepted submissions to a private Signal group, stores broker state in SQLite, tracks Signal reactions, and pays BUGZ rewards when Signal is configured.
- **Properties**:
  - The broker has three distinct incoming XMTP message flows, all initiated by interaction with the main website and sent as strict JSON commands over XMTP.
  - Publisher flow: the currently active work path where a submitter sends a bug submission to the broker for validation, staged status replies, broker-managed review-key handling, and future publish/pin/attestation/registry work.
  - Seller flow: planned, not implemented. A user on the site requests access to preview a bug that is still inside its judging period. The broker will validate the request, enforce the relevant eligibility/payment/access rules, and return access status over XMTP.
  - Bouncer flow: planned, partially represented by existing access-request command handling. A user on the site requests access to the special Signal group. The broker validates credentials and, when Signal is configured, grants or denies group access.
  - Runtime config comes from `BROKER_*` environment variables and `BrokerConfig`.
  - `run-broker.sh` loads `.env`, validates mandatory `BROKER_KEY`, prepares a `.venv-broker*` virtualenv, initializes the SQLite store, and runs the broker.
  - `run-broker.sh` prefers Python 3.10 through 3.13 over generic `python3` so `xmtp-bindings` can use published wheels when available; `BROKER_PYTHON` and `BROKER_VENV_DIR` override this.
  - Base RPC defaults to `https://mainnet.base.org`; BUGZ token defaults to the live Base BUGZ token and can be overridden for local testing.
  - Broker runtime logs are timestamped to stdout and `BROKER_LOG_PATH`, defaulting to `broker.log`; new submissions log a clear `NEW SUBMISSION from <reporter>` line and the full raw XMTP JSON payload, including private detail bodies.
  - `./run-broker.sh debug` enables Python DEBUG logging, Python fault-handler output, Rust XMTP backtraces, `RUST_LOG=debug`, and a default `broker-debug.log`.
  - Signal support is optional. When `BROKER_SIGNAL_CLI` is unset, the broker validates XMTP submissions and records accepted submissions locally without Signal relay, reaction syncing, or reward settlement.
  - The broker dependency is pinned to `xmtp==0.1.6`, which pulls `xmtp-bindings>=0.1.6`.
  - The broker runner temporarily shims `xmtp==0.1.6` wrapper calls and renamed bindings symbols to the updated bindings surface, avoiding a local XMTP DB wipe for that package mismatch.
  - The broker runner patches XMTP agent stream shutdown so a stream error cannot recursively cancel the currently running stream task and hide the original error.
  - `BROKER_KEY` is the single broker wallet key, used for the XMTP identity and BUGZ payouts.
  - `BROKER_DRY_RUN` defaults to `1` in `run-broker.sh`; disable it only when the broker wallet is intentionally funded for live payouts.
  - SQLite tracks processed XMTP message IDs, relayed submissions, Signal message timestamps, active reactions, settlement status, reward amounts, and payout transaction hashes.
  - Signal access requests are gated by `BROKER_ACCESS_MIN_BUGZ`.
  - Live payouts spend from the broker wallet and should run only from an intentionally funded wallet.
- **Test Criteria**:
  - [x] `python3 -m unittest discover -s bots/tests -t bots` covers command parsing, staged broker validation, SQLite maturity, reaction parsing, and reward math.
  - [x] `python3 -m compileall bots scripts/broker-bot.py` checks Python syntax.
  - [x] `bash -n run-broker.sh` checks the root launcher syntax.
  - [ ] Add website-to-XMTP JSON command tests for publisher, seller, and bouncer flows.
  - [ ] Add integration smoke tests with a disposable XMTP wallet and Signal group before production broker launch.

### EAS Reviewer Verdicts

- **Stability**: in-progress
- **Description**: Reviewers write verdict attestations to EAS on Base; the frontend reads verdict state from EAS GraphQL.
- **Properties**:
  - `@ethereum-attestation-service/eas-sdk` is intentionally not used because it pulled Hardhat-era dependencies into npm audit.
  - Writes use direct ethers contract calls in `src/attest/eas.ts`.
  - `ReviewVerdict` is active; `PayoutRecord` remains a placeholder for future public payout records.
- **Test Criteria**:
  - [x] `npm run build` type-checks EAS reads/writes.
  - [ ] Add browser tests for mocked verdict submission once schema UIDs are stable in test config.

### BUGZ Token And Trading

- **Stability**: in-progress
- **Description**: The `/token` route reads BUGZ balances and performs browser-signed Uniswap v4 buy/sell swaps on Base.
- **Properties**:
  - BUGZ defaults to Base token `0x60Df4a0C9A5050c337010cb29C9694cE4d8fbb07`.
  - Base contract read providers disable JSON-RPC batching and use a static network so public Base RPC endpoints do not reject oversized batches during concurrent header/token reads.
  - Buy/sell uses the Clanker-created Uniswap v4 WETH/BUGZ pool key, v4 Quoter, and Universal Router 2.1.1.
  - Buy wraps ETH through the router; sell requires ERC20 plus Permit2 approvals.
  - Trading does not depend on `VITE_BUGZ_TREASURY_ADDRESS`.
- **Test Criteria**:
  - [x] `npm run build` type-checks trade adapters.
  - [ ] Add mocked router/quote Playwright coverage for buy/sell form states.

### Patrons Leaderboard

- **Stability**: in-progress
- **Description**: `/patrons` shows a daily-cached BUGZ holder leaderboard using Etherscan V2 holder data when configured, with a Base RPC Transfer-log fallback.
- **Properties**:
  - Holder snapshots cache in localStorage for 24 hours.
  - The home page patron preview is cache-only and must not trigger fresh scans.
  - The RPC fallback reads 10,000-block Transfer-log pages from `VITE_BUGZ_TOKEN_DEPLOYMENT_BLOCK`.
  - RPC failures render setup guidance for `VITE_ETHERSCAN_API_KEY` or `VITE_BASESCAN_API_KEY`.
- **Test Criteria**:
  - [x] Playwright covers RPC-safe paging, cache reuse, manual refresh, and API-key guidance.

### GitHub Pages Deployment

- **Stability**: stable
- **Description**: GitHub Actions builds `dist/` and deploys to GitHub Pages for the `cheapbugs.net` custom domain.
- **Properties**:
  - Pages uses workflow-based publishing, not legacy branch publishing.
  - Production custom-domain deployments use root-relative Vite base paths.
  - Hash routing is supported for SPA compatibility.
  - Only set `VITE_BASE_PATH` when deploying under a non-root subpath.
- **Test Criteria**:
  - [x] `.github/workflows/deploy-pages.yml` builds the app with GitHub Pages settings.
  - [x] `npm run build` validates local production assets.

### Development Tooling

- **Stability**: stable
- **Description**: Local commands cover frontend, browser, contract, launcher, and broker validation.
- **Properties**:
  - `forge-std` is tracked as `lib/forge-std`; fresh clones need `git submodule update --init --recursive`.
  - The XMTP browser SDK needs the Vite alias and `scripts/fix-xmtp-wasm-worker.mjs` sqlite worker shim.
  - `artifacts/` and `dist/` are generated outputs and should not be committed unless explicitly requested.
- **Test Criteria**:
  - [x] `npm install`
  - [x] `npm run build`
  - [x] `npm run test:e2e`
  - [x] `npm run contracts:build`
  - [x] `npm run contracts:test`
  - [x] `python3 -m unittest discover -s bots/tests -t bots`
  - [x] `python3 -m compileall bots scripts/broker-bot.py`
  - [x] `bash -n run-broker.sh`

## External Integrations

- **Base RPC**: contract reads, writes, BUGZ balances, holder scans, deployments.
- **Thirdweb**: installed-wallet login, WalletConnect QR, signer adapters.
- **ENS**: mainnet name/avatar resolution for session UI.
- **IPFS / Pinata**: encrypted dossier storage and gateway reads.
- **EAS**: reviewer verdict attestations and indexed reads.
- **XMTP**: browser-to-broker report submission and broker status messages.
- **Signal**: private reviewer channel relay and reaction source.
- **Uniswap v4 / Clanker**: browser-signed BUGZ market trading.
- **Foundry**: contract builds, tests, and Solidity-native deployment.

## Verification Commands

```bash
npm install
npm run dev
npm run build
npm run test:e2e
npm run contracts:build
npm run contracts:test
npm run launch:bug-index:dry-run
npm run launch:bug-index:forge:dry-run
npm run launch:token:dry-run
python3 -m unittest discover -s bots/tests -t bots
python3 -m compileall bots scripts/broker-bot.py
```

## Future Milestones

- Implement reporter-signed broker relay before allowing broker-created user-attributed bug-index records.
- Replace frontend reviewer allowlist with an onchain reviewer registry or resolver-backed trust model.
- Add public payout records for broker settlements while keeping `PayoutRecord` as the public record layer.
- Add live XMTP broker smoke tests with disposable identities.
- Add mocked browser tests for verdict submission and BUGZ trading workflows.
- Reduce WalletConnect/XMTP bundle size with route or adapter-level code splitting.
- Add automated CI and ABI drift checks.

## Project Identification

- **Project Name**: CheapBugs
- **Repository URL**: `git@github.com:pierce403/cheapbugs.git`
- **Primary Contact/Team**: `pierce403`
- **Date of Last Update**: 2026-05-17
