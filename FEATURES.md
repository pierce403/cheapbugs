# CheapBugs - Features

This is the living feature map for CheapBugs. It follows the FEATURES.md pattern: each feature declares stability, testable properties, and verification criteria for humans and coding agents.

Update this file whenever feature behavior, system boundaries, deployment assumptions, integrations, or test expectations materially change.

## Project Map

CheapBugs is a static Vite + TypeScript application with Solidity contracts, Node and Foundry deployment scripts, Playwright browser tests, and an optional Python XMTP broker bot.

```text
cheapbugs/
├── bots/                   # Python broker bot package and tests
├── contracts/              # Solidity bug index, bond vault, and treasury vault contracts
├── script/                 # Foundry deployment scripts
├── scripts/                # Deployment, XMTP, and maintenance scripts
├── test/                   # Foundry contract tests
├── tests/                  # Playwright browser tests
├── lib/                    # Foundry libraries
├── public/                 # Static assets and SPA hosting helpers
├── src/
│   ├── attest/             # EAS write adapters
│   ├── auth/               # Thirdweb and embedded-wallet identity helpers
│   ├── config/             # chain, env, reviewer, and integration config
│   ├── contracts/          # frontend contract ABI, vault, price-feed, and adapter reads
│   ├── lib/                # domain logic, crypto, IPFS, treasury, caching, utilities
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
- Public-safe report metadata is stored on Base in `CheapBugsBugIndex`, which now accepts broker-published records only when backed by a reporter EIP-712 signature.
- The verified Base deployment is `CheapBugsBugIndex` `0x515FDbc9876aC26870794E26605c7DD04c18679b`, `CheapBugsBondVault` `0x2Eab99B6d6F1FBDa4fa78a00662E0cf9aBd9f3d3`, and `CheapBugsTreasuryVault` `0x4A080668d9848928dc6D48921cbDc4273fe27A9d`.
- BUGZ bonds are held in `CheapBugsBondVault`; pending withdrawals remain slashable through the 7-day delay.
- Detail-key purchases and ordered broker rewards settle through `CheapBugsTreasuryVault`.
- The vaults hardcode the live Base BUGZ token address `0x60Df4a0C9A5050c337010cb29C9694cE4d8fbb07`; this repo no longer deploys a BUGZ token contract.
- XMTP broker submissions are private XMTP DMs to the broker; the browser builds an encrypted `BugBundle`, signs a contract-verifiable EIP-712 `PublishBug` authorization, sends the out-of-bundle reveal key to the broker, and the broker verifies, pins the bundle through local Kubo IPFS, then calls `CheapBugsBugIndex.publishBug`.
- The remaining broker lifecycle work is post-window details-key reveal and ordered payout completion through the bug index.
- Reviewer verdicts are EAS attestations on Base and are read through EAS GraphQL. Core payout status flags are written directly to `CheapBugsBugIndex` by owner-managed index admins.
- The Python broker is an optional off-static runtime with SQLite state; it does not change the frontend deployment model.

## Features

### Static Web App Shell

- **Stability**: stable
- **Description**: Vite/TypeScript browser app with routes for `index`, `submit`, `review`, `report`, `profile`, `bond`, `treasury`, `manage`, `token`, `patrons`, and `about`, a compact header session area, a GitHub icon link, build metadata, and a centralized development banner.
- **Properties**:
  - The first screen is the usable app, not a landing page.
  - The home intro describes CheapBugs as a public goods crowdfunding protocol and summarizes the static GitHub/IPFS/XMTP/Base architecture without listing raw contract addresses, a patrons preview, or a footer in the first screen.
  - Header login/session controls remain compact and do not reintroduce old chain/storage/wallet/SIWE debug rows.
  - Connected-wallet header BUGZ status shows `bugz: loading` before balance reads complete. Temporary Base RPC rate-limit failures are logged as throttled warnings; non-rate-limit failures still log high-visibility console errors.
  - Header BUGZ status only reads the connected wallet BUGZ balance; it must not load token metadata, treasury BUGZ, or treasury native ETH on ordinary route changes.
  - Browser contract adapters disable ethers' automatic HTTP 429 retry loop, dedupe in-flight Base RPC reads, cache successful reads briefly, serialize public Base reads through a shared queue, use exponential global cooldown after rate-limit errors, and persist public bug-index reads where useful.
  - Routine `[cheapbugs]` info logs are opt-in through `VITE_DEBUG_LOGS=1` or `localStorage.setItem("cheapbugs.debugLogs", "1")`; warnings and errors remain visible.
  - Bug-index reads fail open after a short timeout so the app shell is not blocked by a slow public RPC.
  - Header build metadata shows `VITE_BUILD_ID`/`VITE_BUILD_TIME` when provided, otherwise falls back to the bundle commit hash and current build time, and formats build time in the viewer's local timezone.
  - The development banner text is centralized in `src/app.ts`, and success/ready status styling uses the orange warning/brand palette instead of the green success palette.
  - The `about` route is a static protocol explainer covering bug submission, broker publishing, judging, reveal, payouts, smart contract mechanics, the tech stack, and BUGZ tokenomics without making public RPC or IPFS reads.
  - The `bond` and `treasury` navigation items are always available; `bond` routes to canonical `/bond` while legacy `/stake` remains readable for old links. The `manage` navigation item appears only after the connected wallet is recognized as the owner of at least one CheapBugs contract.
  - Index admin authority does not grant `manage` navigation; admins use `/review` for report status flagging.
  - The `about` navigation item stays at the end of the nav, after the owner-only `manage` item when it is visible.
  - On mobile widths, the shell stacks the banner/header content, keeps auth controls full-width, and renders navigation as stable equal-width two-column tap targets.
- **Test Criteria**:
  - [x] `npm run build` compiles the static app.
  - [x] `npm run test:e2e` covers the development banner text, submit XMTP ready/success orange status styling, GitHub brand icon, build metadata, mobile navigation layout, the about route, header BUGZ status states, owner-only manage navigation, and that ordinary routes do not trigger treasury dashboard reads.

### Wallet Auth And Embedded Wallet Identity

- **Stability**: in-progress
- **Description**: Thirdweb wallet login with injected-wallet SIWE, a CheapBugs WalletConnect handoff, session restore, ENS display, and site-generated embedded wallets that can sign both Base transactions and XMTP messages.
- **Properties**:
  - `VITE_THIRDWEB_CLIENT_ID` has a committed public default for static deploys.
  - `VITE_WALLETCONNECT_PROJECT_ID` can be set in deployment environments so WalletConnect QR/mobile pairing uses a CheapBugs-specific WalletConnect Cloud project id instead of Thirdweb's bundled default.
  - External wallet reconnect hints are stored in `cheapbugs.walletSession.v1`; SIWE proofs are stored in `cheapbugs.siweSession.v1`.
  - Embedded CheapBugs wallets are stored in `cheapbugs.localXmtpIdentity.v1` and can sign XMTP messages, `PublishBug` authorizations, and Base smart-contract transactions.
  - When login would otherwise open a WalletConnect QR path, the app first shows a CheapBugs modal with `connect with WalletConnect`, `reset WalletConnect`, and `I don't have a crypto wallet` options.
  - Failed or disconnected WalletConnect sessions replace the in-memory WalletConnect wallet object and can clear this origin's stale WalletConnect transport state from localStorage, sessionStorage, and `WALLET_CONNECT_V2_INDEXED_DB`; the modal reset button exposes the same recovery path for stuck browser sessions.
  - Wallet rejection errors such as WalletConnect code `5000` preserve the wallet's rejection message for the UI and skip stale-storage deletion so ordinary cancel/reject flows do not produce misleading IndexedDB cleanup warnings.
  - The frontend filters the known harmless Thirdweb/WalletConnect `session_request ... without any listeners` console-noise case unless debug logs are enabled.
  - The no-crypto-wallet path opens an embedded-wallet modal that can generate a new browser-stored wallet or import `cheapbugs-key.json`.
  - Embedded-wallet profiles expose an `export cheapbugs-key.json` action. The exported JSON contains the embedded wallet address, private key, optional mnemonic, derivation path, and metadata, and must be treated as private key material.
  - ENS avatars are read from the raw `avatar` text record and sanitized to HTTPS or IPFS gateway URLs.
  - ENS profile results cache in `cheapbugs.ensProfileCache.v1` for 24 hours so page reloads do not re-query mainnet ENS, with a profile-modal refresh button for manual cache bypass.
  - Report author links route to `/profile/:address`, display ENS names and avatars when available, show BUGZ balance, and list recent submissions found through the current bug-index read path.
- **Test Criteria**:
  - [x] Playwright covers ENS-backed profile modal behavior, avatar URL handling, local ENS cache reuse, manual ENS refresh, embedded-wallet creation, WalletConnect stale-state reset, `cheapbugs-key.json` import, and embedded-wallet export from the profile surface.
  - [x] `npm run build` catches Thirdweb/XMTP integration type drift.

### CheapBugs Bond Vault

- **Stability**: in-progress
- **Description**: `CheapBugsBondVault` escrows live Base BUGZ bonds used for CheapBugs reputation and weighted bug voting.
- **Properties**:
  - Users bond BUGZ with `bond(amount)`.
  - Withdrawals are two-step: `requestWithdrawal(amount)` moves active bond into pending withdrawal, then `withdraw()` releases it only after 7 days.
  - Any new bond from the same user cancels pending withdrawals and restores the pending amount to active bond before adding the new BUGZ.
  - Pending withdrawals remain slashable so users cannot immediately escape after bad behavior.
  - Owner-managed slashers can slash a percentage of active plus pending bond in basis points; slashed BUGZ transfers directly to the configured treasury.
  - `bondOf(account)` returns total slashable exposure, `activeBondOf(account)` returns voting-eligible bond, and `getLevel(account)` returns `floor(log10(active whole BUGZ))`.
  - Pending withdrawals are excluded from `getLevel`; balances below 10 whole BUGZ produce level 0 and cannot add nonzero vote weight.
  - Current bonded addresses are enumerable with `bondedAddressCount`, `bondedAddressAt`, and `bondedAddressList`.
  - The `/bond` route lets connected users approve BUGZ for the bond vault, bond BUGZ, request the two-step withdrawal, and withdraw when the 7-day delay has elapsed; legacy `/stake` is a compatibility alias.
  - The `/bond` route prominently warns bonded users that anti-social activity, including spamming, harassment, or criminal activity related to platform bugs, can burn their bond immediately into the treasury.
  - The bond UI shows wallet BUGZ, allowance, active bond, pending withdrawal, current level, next-level threshold, and a live countdown/progress bar for step-2 withdrawal readiness without showing raw bond-vault or BUGZ-token contract addresses. During the waiting period, the withdraw panel explicitly labels the in-flight pending BUGZ amount next to the countdown.
  - After a withdrawal request transaction confirms, the bond UI keeps a session-scoped local pending-withdrawal hint and countdown visible if the next public Base read still returns stale vault state. The hint clears once chain reads show pending state, or after a later bond/withdraw action.
  - The add-bond form has one primary action button. It says `approve bugz` when the entered amount is above the current allowance, and `bond bugz` when current allowance is sufficient.
  - The bond dashboard keeps RPC reads conservative: it reads `accountOf`, computes the displayed level client-side from active whole BUGZ, uses the fixed 7-day withdrawal delay, and skips nonessential balance or allowance reads during a Base RPC cooldown.
- **Test Criteria**:
  - [x] Forge unit tests cover bonding, two-step withdrawal, withdrawal cancellation, pending-withdrawal slashing, slasher permissions, full slash removal, and address enumeration.
  - [x] Forge fuzz tests cover level math and percentage slash accounting.
  - [x] Forge invariant tests prove the vault's BUGZ balance equals the listed active-plus-pending bond exposure across randomized bond, withdrawal, cancellation, and slash sequences.
  - [x] Playwright covers the bond route dashboard, level display, allowance display, one-button approve/bond behavior, hidden contract addresses, pending-withdrawal warning, in-flight pending amount, withdrawal countdown state, local stale-read withdrawal hint, and Base RPC rate-limit backoff with mocked Base RPC.

### Owner Manage Console

- **Stability**: in-progress
- **Description**: `/manage` is a wallet-gated owner console for CheapBugs contract-suite administration.
- **Properties**:
  - The app reads `owner()` from `CheapBugsBugIndex`, `CheapBugsBondVault`, and `CheapBugsTreasuryVault` after wallet login.
  - `manage` appears in navigation only when the connected wallet owns at least one contract in the suite.
  - Index admins who are not contract owners do not see owner controls and should use `/review` for report status decisions.
  - Direct `/manage` access by non-owner wallets renders an owner-only gate instead of transaction controls.
  - The console displays the owner/address status for all three contracts plus current index brokers/admins, index vault wiring, treasury brokers, treasury index, standard payout divisor, and bond slash treasury.
  - Index owner controls expose `setBroker`, `setAdmin`, `setBondVault`, `setTreasuryVault`, and `transferOwnership`.
  - Treasury owner controls expose `setBroker`, `setIndex`, `setStandardPayoutDivisor`, and `transferOwnership`.
  - Bond-vault owner controls expose `setSlasher`, `setTreasury`, and `transferOwnership`.
  - `renounceOwnership` is intentionally not exposed in the browser UI because it can permanently remove live administrative recovery paths.
  - The UI prechecks the connected owner where possible, but the contracts remain the source of authority for every owner-only call.
- **Test Criteria**:
  - [x] Playwright covers manage nav visibility for owner wallets, direct non-owner gating, and the owner action surface with mocked Base RPC.
  - [x] `npm run build` type-checks owner adapters and route wiring.

### CheapBugs Treasury Vault

- **Stability**: in-progress
- **Description**: `CheapBugsTreasuryVault` holds live Base BUGZ treasury funds, records detail-key purchases, and pays reporter rewards when called by the index.
- **Properties**:
  - Users can deposit BUGZ into the treasury and unlock detail-key access with `purchaseDetailKey(reportHash, amount)`.
  - Detail-key purchases transfer BUGZ into the treasury, update `detailKeyPayments(reportHash, buyer)`, and append enumerable purchase records for broker verification.
  - The owner sets the authorized bug index with `setIndex`.
  - The owner manages treasury brokers independently from the index broker list.
  - Reward disbursement is only callable by the configured index through `payRewardFromIndex(broker, recipient, multiplier)`.
  - `payRewardFromIndex` also verifies the broker is authorized by the treasury, so payout authority requires both the index and treasury to trust the broker.
  - Standard payout is `BUGZ balance / standardPayoutDivisor`, defaulting to 1000. The owner can adjust the divisor to any nonzero value.
  - Broker multipliers are capped at 10. A multiplier of 0 records a zero-payout completion.
  - The `/treasury` route encourages users to fund the treasury, exposes a copyable treasury address, and shows the current treasury BUGZ balance.
  - The `/treasury` route shows the current base payout range per valid bug by reading `calculateRewardAmount(1)` through `calculateRewardAmount(10)`, which is normally 0.1% to 1% of treasury funds.
  - Treasury USD estimates prefer the Dex Screener Base token-pairs API for BUGZ/USD, cache successful browser quotes for 10 minutes, keep expired quotes as a stale fallback marked `(cached)` when fresh pricing fails, and fall back to a BUGZ/WETH Uniswap v4 quote plus the Chainlink Base mainnet ETH/USD standard feed when no cached price is available. If pricing fails entirely, the route keeps BUGZ-denominated values visible and shows an informative warning.
  - The treasury route avoids token metadata RPC reads on page load. It uses cached metadata if some other route already loaded it, otherwise defaults to `BUGZ` with 18 decimals for the live token.
  - The `/treasury` route renders cached or placeholder data immediately and refreshes values through throttled background Base reads so visiting the page does not launch a burst of concurrent RPC calls.
- **Test Criteria**:
  - [x] Forge unit tests cover deposits, detail-key purchase accounting, broker list management, index-only payouts, treasury broker checks, divisor changes, multiplier caps, and reward transfers.
  - [x] Forge fuzz tests cover payout math across balances, divisors, and multipliers.
  - [x] Playwright covers the treasury route's current value, 0.1%-1% payout range, USD conversion, copy-address action presence, and fail-open price-read warning.

### Detail-Key Unlock Sales

- **Stability**: in-progress
- **Description**: During the reveal delay, buyers can request an offchain broker quote, pay the treasury vault onchain, and receive the report's details key over XMTP after broker verification.
- **Properties**:
  - The report page and locked home/index rows show lock-button early-access paths while the report is still unrevealed and the browser does not already have a stored key.
  - Quote requests use strict JSON schema `cheapbugs.detail_unlock.v1`, type `detail_unlock_quote`, and include request id, buyer, broker, chain id, bug index, treasury vault, and report hash.
  - The broker binds the buyer to the authenticated XMTP sender; message-supplied `buyer_address` values that do not match sender identity are rejected before pricing or key release.
  - The broker computes the default quote as `CheapBugsTreasuryVault.calculateRewardAmount(1) * ceil(days remaining until the 7-day reveal window)`, stores the quote by request id for 15 minutes, and returns price wei, days remaining, and expiry over XMTP.
  - The browser preflights BUGZ treasury allowance, requests a BUGZ approval transaction first only when the quote exceeds that allowance, calls `CheapBugsTreasuryVault.purchaseDetailKey(reportHash, amount)`, waits for confirmation, then sends a `detail_unlock_paid` XMTP message with the original request id and transaction hash.
  - Before payment, the browser verifies the transaction signer matches the connected buyer session and decodes BUGZ custom errors such as `ERC20InsufficientAllowance` into user-facing approval guidance. After a confirmed approval transaction in the same unlock flow, the payment skips the immediate allowance re-read so lagging Base RPC state does not block a valid purchase.
  - The broker does not trust buyer-supplied amounts. It verifies the stored quote, report hash, buyer, expiry, transaction receipt success, transaction sender, transaction recipient, and `detailKeyPayments(reportHash, buyer) >= quoted price` before sending the details key.
  - After receiving the key, the browser stores it through the existing per-report access-key localStorage path and decrypts the encrypted BugBundle details locally.
- **Test Criteria**:
  - [x] Python unit tests cover quote parsing, spoofed buyer rejection, quote pricing, payment verification, key release, and underpayment rejection.
  - [x] `npm run build` type-checks the browser quote/payment/key-storage flow.
  - [ ] Live XMTP and Base payment testing is still manual because it requires a funded buyer wallet and the production broker inbox.

### Onchain Bug Index

- **Stability**: in-progress
- **Description**: `CheapBugsBugIndex` stores broker-published, reporter-signed bug records; coordinates details-key reveal, bonded voting, admin status guidance, and ordered payouts.
- **Properties**:
  - Only owner-authorized brokers can publish bugs.
  - Published records require a reporter EIP-712 signature over the report fields, broker address, nonce, deadline, BugBundle hash, encrypted details hash, details-key commitment, and reveal time. The broker-produced IPFS CID is stored but is not in the signature because it is known only after pinning.
  - Reporter nonces are one-time use, signatures expire at their deadline, and signatures bind the broker and index domain.
  - The index requires `revealAfter` to be at least 7 days after onchain publication.
  - Submitter-built BugBundles sign a reveal time 7 days plus a 1-hour publish buffer after browser creation so broker validation, IPFS pinning, and transaction mining do not make the signed reveal window too short.
  - Public records include report hash, report id, reporter, created time, disclosure mode, public summary, BugBundle CID, target kind, target hash, tags, content hash, BugBundle hash, encrypted details hash, details-key commitment, reveal status, admin status, and payout state.
  - Report titles and human-readable target references are not separate onchain fields; the frontend reads them from the public core of the pinned `cheapbugs.bug_bundle.v1` payload and falls back to onchain report id/target kind if the public IPFS read fails or is malformed.
  - The report detail page renders a readable report overview rather than an onchain debug table: title, summary markdown, date, BugBundle download, author, and human target stay visible, while report hash/id, reporter address, disclosure mode, hashes, tags, and duplicate decrypted submission fields are omitted from the main view. Private details render above trusted review state.
  - The stored details-key commitment is SHA-256 over the raw 32-byte key. Brokers reveal the raw `bytes32` key after the 7-day window.
  - Owner-managed admins can flag bugs as `Valid`, `Invalid`, or `Spam`; payout completion requires an admin status.
  - The `/review` route recognizes either frontend reviewer allowlist access or onchain index admin authority. The queue is a compact date/title/author/details/admin-flag table without contract-address or schema-catalog chrome; index admins see pending status inside the admin flag dropdown and can set `valid`, `invalid`, or `spam`.
  - The review queue has a local pending-only checkbox that filters the table to unreviewed reports.
  - Bonded users can vote up or down before the reveal window closes. Vote weight is snapshotted at vote time from `CheapBugsBondVault.getLevel(voter)`.
  - Bug payouts must be completed in report order. Only an authorized broker can complete payout, and invalid or spam bugs require a zero multiplier.
  - On payout completion, the index reveals the details key if needed, calls `CheapBugsTreasuryVault.payRewardFromIndex`, stores the paid amount/multiplier, and advances the payout cursor.
  - Index Halt is a known ordered-payout risk in the current deployed index: if the report at `nextPayoutIndex` has an unavailable or mismatched details key, later report payouts remain blocked because there is no skip/quarantine/recovery path in this index version.
  - Contract-specific values stay behind `src/config/chains.ts`, `src/config/env.ts`, and `src/contracts/bugIndex.ts`.
  - Direct browser-to-index submission is disabled; the only browser-to-index write helper is bonded voting through `submitBondVote`.
  - The frontend defaults to the verified Base contract suite, so new broker-published bugs can be read into index/recent-report views without requiring `VITE_BUG_INDEX_ADDRESS` in local env.
  - Recent-report reads use in-memory caching, localStorage-backed public bug-index detail caches, in-flight request reuse, and fail-open public metadata/ENS lookups so route changes and reloads do not repeatedly call `latestReportHashes`/`getReport` or block the shell on optional display data. Rows show `loading...` instead of the report id while a fresh BugBundle title is still propagating through the gateway.
  - Home/index bug-listing tables show score, title, author, date, and unlock columns in that order. The score, date, and unlock columns are kept tight and fixed-width, with score controls centered and unlock cells right-aligned; the target column is intentionally omitted from this compact archive view so long titles get the widest column. Bug titles are persistent underlined links to their report detail pages.
  - Home/index score cells include bonded vote controls in the form up arrow, net vote weight, down arrow. Hover titles expose total up/down weights, the connected user's current direction lights up, and level-0 vote attempts show a bond-required modal with a route to `/bond`.
  - The unlock column renders days, hours, or minutes until `revealAfter`, then falls back to `unlockable` or `unlocked` after reveal. Locked rows show a small lock icon next to the countdown that opens the shared detail-unlock quote/payment modal.
  - Launcher scripts refresh frontend ABI files after compilation, deploy/wire `CheapBugsBondVault`, `CheapBugsTreasuryVault`, and `CheapBugsBugIndex` together, check the deployed wiring, and verify all three contracts on Etherscan/BaseScan by default for real deployments.
  - The Node launcher writes tracked deployment manifests and generated contract artifacts under `deployments/base-8453/`, including compiler/tool versions, optimizer and `via_ir` settings, source/package hashes, constructor arguments, transaction logs for broadcasts, verification command inputs, and generated ABI/bytecode artifacts.
  - Launchers use `BUG_INDEX_DEPLOYER_PRIVATE_KEY` when set; otherwise they deploy from `BROKER_KEY`, seed that broker as the initial broker when no broker list is provided, and transfer ownership to `0x7ab874Eeef0169ADA0d225E9801A3FfFfa26aAC3` by default.
- **Test Criteria**:
  - [x] `npm run contracts:build` compiles Solidity contracts.
  - [x] `npm run contracts:test` covers broker publication, reporter signatures, nonce replay, deadline expiry, reveal timing, details-key commitment checks, admin status, bonded voting, ordered payouts, zero-payout invalid bugs, treasury broker removal, role abuse, treasury transfer integration, and Index Halt characterization tests for disappearing brokers and mangled details-key commitments.
  - [x] `test/CheapBugsBugIndex.t.sol` includes `test_indexHaltDisappearingBrokerWithoutDetailsKeyBlocksLaterPayouts` and `test_indexHaltMangledDetailsKeyCommitmentBlocksPayoutCursor` to document current ordered-payout halt behavior.
  - [x] Forge fuzz tests cover reveal-window rejection, bonded-vote weight math, and payout multiplier math.
  - [x] `npm run launch:bug-index:dry-run` validates the Node launcher and frontend ABI refresh.
  - [x] `npm run launch:bug-index:forge:dry-run` validates the Foundry launcher.
  - [x] Real launchers require an Etherscan/BaseScan API key for default contract verification unless `BUG_INDEX_VERIFY_CONTRACTS=0` is explicitly set.
  - [x] Launchers support `BROKER_KEY` as the deployer fallback and keep final ownership separate from the funded deployer.
  - [x] `CHEAPBUGS_LIVE_PAYOUT_FORK=1 forge test --match-contract CheapBugsLivePayoutForkTest -vvv` is an opt-in Base fork rehearsal for live ordered payouts. The readiness test checks index/treasury wiring, broker permissions, admin presence, and report status. The snapshot payout simulation needs `CHEAPBUGS_LIVE_PAYOUT_DETAIL_KEYS` as comma-delimited raw `bytes32` details keys in payout order, plus optional `CHEAPBUGS_LIVE_PAYOUT_STATUSES` and `CHEAPBUGS_LIVE_PAYOUT_MULTIPLIERS`.
  - [x] Playwright covers the home route loading `latestReportHashes`/`getReport` from the configured index, enriching rows from mocked BugBundle public metadata, rendering the score/title/author/date/unlock order with centered score controls and right-aligned unlock cells, keeping title links visibly underlined, using `loading...` while fresh BugBundle metadata is delayed, caching those reads across route changes and reloads, resolving the author ENS name, routing to the author profile page, displaying bonded vote totals/current direction, opening the detail-unlock modal from locked rows, and routing level-0 voters to bonding.
  - [x] Playwright covers an onchain index admin who is not a contract owner seeing the compact review queue, no contract/schema chrome, the pending status dropdown, and the pending-only filter while the owner-only `manage` nav stays hidden.
  - [x] `deployments/base-8453/cheapbugs-contract-suite.latest.json` and `deployments/base-8453/generated/latest/*.json` provide committed reproducibility records without private keys or explorer API keys.

### Removed Direct Submission Path

- **Stability**: removed
- **Description**: The old browser path that encrypted private dossier JSON, uploaded it directly, and attempted a browser-to-index write has been removed from the active API surface.
- **Properties**:
  - Direct browser-to-index submission writes are not exposed from `src/contracts/bugIndex.ts`; bonded vote writes are the separate active onchain interaction.
  - New submissions must go through the XMTP broker flow with a reporter EIP-712 `PublishBug` authorization.
  - Storage helpers remain for reading existing encrypted content and writing review notes, but not for direct bug-index submission.
- **Test Criteria**:
  - [x] `npm run build` type-checks the removed write surface.

### XMTP Broker Submission

- **Stability**: in-progress
- **Description**: The submit route sends bug submissions as strict JSON XMTP DMs to the default broker wallet `0xea6995fc3674e1e94736766f5eeefb0506e4ef32`.
- **Properties**:
  - `VITE_BROKER_XMTP_ADDRESS` overrides the default broker wallet only when a different broker is needed.
  - The frontend form collects title, target reference, bug type, severity, target interest, public summary, and private details. Repro steps, evidence, Signal recipient, contact hints, target kind, tags, and review access keys are intentionally not user-facing.
  - Bug type is a malleable broker-triage hint with current values `0day`, `nday`, `web`, `web3`, `net`, and `intel`.
  - Severity and target interest are malleable broker-triage hints with current slider values `low`, `medium`, `high`, and `critical`.
  - The submit route validates broker text-field limits before wallet, XMTP, or PublishBug signing work starts: title 3-120 characters, target reference 2-160 characters, public summary 10-2,000 characters, and private details 10-12,000 characters after trimming.
  - The private details field warns submitters that it must include full step-by-step instructions and/or PoC demonstrating impact or the broker may mark the report invalid.
  - The frontend sends schema `cheapbugs.bug_submission.v1`, version `1`, type `submission`, reporter address, broker address, `bug_type`, `severity`, `target_interest`, title, public summary, the form target reference with target kind `other`, client metadata, an encrypted `bug_bundle`, a reporter EIP-712 `publish_authorization`, and an out-of-bundle `details_key`.
  - The frontend generates the random details key, encrypts details into the BugBundle with AES-256-GCM, hashes the canonical BugBundle core, and signs the `PublishBug` EIP-712 message that the index verifies. The signed `revealAfter` is 7 days plus a 1-hour publish buffer after bundle creation.
  - The submit route shows an inline XMTP status indicator for wallet/signing readiness, send progress, success, and failure; ready and success states follow the orange app theme instead of green.
  - The submit route shows a processing-submission modal while broker XMTP submission work is in progress, keeps it open across broker status replies, treats IPFS pinning as progress, and only marks the submission complete after the broker confirms live onchain publication or an explicit broker dry run.
  - The submit route opens a wallet-signature waiting modal while an external wallet or WalletConnect device must approve either XMTP registration or the `PublishBug` authorization signature.
  - XMTP submission status persists across incidental app rerenders so wallet registration progress and failures are not hidden by header/session updates.
  - Browser XMTP registration skips redundant registration for already-registered installations and surfaces wallet-signature progress before any broker DM is attempted.
  - The submit button remains clickable when disconnected so the form can explain the missing XMTP wallet instead of appearing inert.
  - The broker verifies the BugBundle and publish authorization before pinning: schema, fields, reporter/broker/chain/index binding, EIP-712 signature recovery, key commitment, encrypted details hash, AAD, and successful details decryption.
  - The broker rejects mangled out-of-bundle details keys before IPFS pinning or index publication; `CommandParsingTest.test_reject_real_authorized_bugbundle_mangled_details_key_before_pin` covers a real signed BugBundle whose supplied key does not match the signed commitment.
  - Accepted submission records use the verified PublishBug reporter. If the verified EIP-712 reporter differs from `reporter_address`, or an available authenticated XMTP sender differs from the verified reporter, the broker rejects the message before credential checks, IPFS pinning, index publication, Signal relay, or payout persistence.
  - In live mode, the broker preflights `revealAfter` before IPFS pinning and rejects bundles that can no longer satisfy the index's 7-day-from-publication minimum.
  - The broker rejects malformed JSON, missing required core fields, unexpected fields, invalid bug type or rating values, invalid or missing publish authorizations, invalid provided target references, and invalid reporter credentials.
  - The broker sends plain text XMTP status messages after each successful validation stage: JSON valid, fields well formed, publish authorization/details valid, target valid, credentials valid, IPFS pinned, and bug-index published or dry-run complete.
  - Incoming XMTP text or JSON flow types that do not match a recognized broker flow receive `hello.` as a liveness reply and are marked processed. Recognized but malformed submission/access flows keep their validation-error replies.
  - After IPFS pinning, the broker maps the verified `PublishBug` authorization and pinned BugBundle URI into `CheapBugsBugIndex.publishBug`, checks broker authorization and gas funding before broadcast, waits for a receipt, and records the report hash plus index transaction hash in SQLite.
  - If bug-index publication fails after IPFS pinning, the broker records an `index_failed` submission with the pinned CID and returns an XMTP error that includes the actionable publish failure. Known index custom errors such as `InvalidRevealAfter`, `RevealNotReady`, and `SignatureExpired` are decoded into timestamped guidance.
  - Broker status messages intentionally avoid XMTP reply-content encoding so the submission flow does not depend on nonessential reply-content codec behavior.
  - After sending the submission DM, the browser waits for broker plain text replies in the same XMTP conversation. `Submission complete: Bug published onchain...`, `Submission complete: Bug already exists onchain...`, or `Submission complete: Bug index dry-run complete...` is treated as terminal success; target, credential, JSON, IPFS, or bug-index publish failure replies are terminal errors.
  - Submission credential checks use `BROKER_REPUTATION_BLOCKLIST`; `BROKER_SUBMISSION_MIN_BUGZ` defaults to `0` for open submissions and can be raised later to require a BUGZ balance.
- **Test Criteria**:
  - [x] Python unit tests cover strict JSON parsing, required fields, publish-authorization bundle-hash validation, BugBundle failure handling, real encrypted bundle verification in the broker venv, target validation, staged status messages, credential failure, authenticated XMTP sender/reporter mismatch rejection, live reveal-window preflight, bug-index publish call shaping, decoded publish failures, and dry-run handling.
  - [x] Python unit tests cover `hello.` liveness replies for unrecognized XMTP text and JSON flow types.
  - [x] Playwright covers the default broker wallet, inline XMTP status, broker field-size validation before wallet checks, disconnected submit feedback, title/target field ordering, private-details warning copy, PublishBug-signature wait modal, and structured XMTP submit UI including IPFS-progress and onchain-completion modal states.
  - [x] Browser and broker code create and verify the EIP-712 `PublishBug` envelope required by the bug index.
  - [ ] End-to-end live XMTP inbox testing is still manual because it requires registered XMTP wallets.

### BugBundle IPFS Reveal Model

- **Stability**: in-progress
- **Description**: A submitted bug becomes one versioned `BugBundle` JSON object pinned to IPFS, with public metadata, broker-triage guidance, and encrypted details. The reporter's EIP-712 publish authorization travels in the XMTP command and is verified before pinning.
- **Properties**:
  - The bundle schema is `cheapbugs.bug_bundle.v1`.
  - The bundle includes public fields such as reporter, broker, chain id, reveal timing, title, public summary, target reference, `bug_type`, `severity`, and `target_interest`.
  - The bundle includes the encrypted `details` ciphertext and encryption metadata, but never the details key.
  - Current implementation has the submitter generate the random details key, encrypt the details, sign the `PublishBug` authorization over the bundle hash and commitments, and send the bundle plus out-of-bundle details key to the broker over XMTP.
  - The broker verifies the EIP-712 authorization, verifies the supplied key commitment, decrypts the details for objective well-formedness checks, live-preflights the reveal window before pinning, pins the encrypted bundle payload to IPFS without adding broker status fields, then publishes the signed report commitment to the bug index unless `BROKER_DRY_RUN=1`.
  - Broker pinning uses a locally running Kubo HTTP API. `BROKER_IPFS_API_URL` defaults to `http://127.0.0.1:5001`.
  - On broker startup, the `run` command checks Kubo `/api/v0/version` and verifies `/api/v0/add` accepts write requests using a tiny unpinned probe.
  - `BROKER_IPFS_GATEWAY_URL` defaults to the frontend's current `https://ipfs.io/ipfs` gateway. `BROKER_IPFS_PRIME_GATEWAY=1` performs a best-effort gateway fetch after pinning, but gateway caching is not durable and can fail when the local node is not publicly reachable through the IPFS swarm.
  - The broker stores the out-of-bundle details key and bundle metadata in SQLite for later reveal work.
  - The bug index stores the bundle CID, bundle/content commitments, encrypted details hash, reveal time, and details-key commitment.
  - The frontend treats gateway-fetched BugBundle public metadata as untrusted display data: it validates shape and string fields, sanitizes rendered text, and falls back to onchain fields on timeout or malformed content.
  - The report detail route renders public summary and decrypted private details as dedicated multi-line markdown areas. Titles are bold, raw HTML remains escaped, unsafe links are not activated, and fenced code blocks include a top-right copy button.
  - Browser IPFS reads cache the full encrypted BugBundle JSON in localStorage for 30 days, reuse in-flight fetches by CID, and fall back to the last cached BugBundle when a public gateway rate-limits or fails. Decrypted private details are not persisted in this cache.
  - After the 7-day judgment period, a broker adds the raw 32-byte details key to the bug index. The index verifies `sha256(rawKey) == detailsKeyCommitment`; browsers can then fetch the bundle from IPFS, read the key from the index, store it in the existing per-report access-key localStorage map, decrypt details locally, and render the bug as ordinary readable content.
- **Test Criteria**:
  - [x] Broker tests cover EIP-712-authorized encrypted BugBundle verification and pinning without plaintext details in the pinned JSON.
  - [x] Broker tests cover Kubo API startup/add request wiring without requiring a live Kubo daemon.
  - [x] Browser tests cover PublishBug signature prompt state.
  - [x] Broker tests prove the broker rejects altered bundle authorization hashes and invalid BugBundle validation results.
  - [x] Playwright covers cached BugBundle and bug-index detail rendering across reloads and when Base/IPFS providers return 429.
  - [ ] Browser tests cover submitter-side bundle construction, details encryption, and key commitment generation against deterministic vectors.
  - [ ] Broker tests add dedicated cases for bad recovered signatures, mismatched details keys, and unintelligible decrypted details.
  - [x] Contract tests prove keys cannot be revealed before the judgment window and revealed keys must match the stored commitment.
  - [x] Read-path tests cover automatic post-reveal IPFS fetch, local key storage, browser decryption, markdown rendering, raw HTML escaping, unsafe-link rejection, and code-block copy buttons.

### Reporter-Signed Broker Relay

- **Stability**: in-progress
- **Description**: Let the broker pin private submission material to IPFS and submit bug-index records without being able to forge reports from other users.
- **Properties**:
  - `CheapBugsBugIndex.publishBug` now requires an EIP-712 reporter signature before accepting broker-published records.
  - The signed message binds reporter, broker wallet, Base chain id through the EIP-712 domain, bug-index contract address through the EIP-712 domain, report fields, BugBundle hash, encrypted details hash, details-key commitment, reveal time, created time, nonce, and deadline. The broker-produced IPFS CID is stored after pinning but is not part of the reporter signature.
  - The broker may verify, pin IPFS, and pay gas, but it must not be able to choose or alter the reporter address or signed bundle content accepted by the registry.
  - `CheapBugsBugIndex` rejects broker-relayed submissions unless the ECDSA signature recovers to the claimed reporter. EIP-1271 contract-wallet support remains future work.
  - The contract prevents replay through used reporter nonces, broker binding, EIP-712 domain binding, signature deadlines, and duplicate report hashes.
  - XMTP sender identity is useful broker-side evidence, but it is not enough for the smart-contract-level anti-forgery claim.
  - Private plaintext details must never be placed onchain; onchain records should contain public metadata, IPFS CIDs, commitments, content hashes, and post-window details keys only.
  - The browser and Python broker now create, verify, and relay the contract EIP-712 publish signature to the index after IPFS pinning. `BROKER_DRY_RUN=1` verifies the path and records local state without broadcasting or relaying to Signal.
  - Because `revealAfter` is signature-bound, any submission signed with a reveal window that is too short for live publication must be resubmitted from an updated frontend.
- **Test Criteria**:
  - [x] Contract tests prove a broker cannot submit a forged report for an arbitrary reporter.
  - [x] Contract tests prove valid reporter signatures are accepted through the broker-relay path.
  - [x] Contract tests prove wrong broker, expired/deadline, and replayed submissions fail.
  - [x] Browser tests cover the signature prompt state.
  - [x] Broker tests verify signed envelopes before IPFS pinning.
  - [x] Broker tests cover shaping the verified authorization into `publishBug`, recording publish failures after IPFS pinning, and dry-run behavior.

### Python Broker Bot

- **Stability**: in-progress
- **Description**: Optional Python runtime receives website-initiated JSON commands over XMTP, validates broker flows, optionally relays accepted submissions to a private Signal group, stores broker state in SQLite, tracks Signal reactions, and pays BUGZ rewards when Signal is configured.
- **Properties**:
  - The broker has three distinct incoming XMTP message flows, all initiated by interaction with the main website and sent as strict JSON commands over XMTP.
  - Publisher flow: the currently active work path where a submitter sends a bug submission to the broker for validation, staged status replies, broker-managed review-key handling, IPFS pinning, and bug-index publication.
  - Seller flow: implemented for early detail-key unlocks. A user on the report page requests a quote, pays the treasury vault, and receives the details key only after the broker verifies the authenticated XMTP buyer, stored quote, transaction receipt, and `detailKeyPayments` ledger.
  - Bouncer flow: planned, partially represented by existing access-request command handling. A user on the site requests access to the special Signal group. The broker validates credentials and, when Signal is configured, grants or denies group access.
  - Runtime config comes from `BROKER_*` environment variables and `BrokerConfig`.
  - `run-broker.sh` loads `.env`, validates mandatory `BROKER_KEY`, prepares a `.venv-broker*` virtualenv, initializes the SQLite store, and runs the broker.
  - `run-broker.sh` prefers Python 3.10 through 3.13 over generic `python3` so `xmtp-bindings` can use published wheels when available; `BROKER_PYTHON` and `BROKER_VENV_DIR` override this.
  - Base RPC defaults to `https://mainnet.base.org`; BUGZ token, bug index, and treasury vault default to the live Base deployment and can be overridden for local testing.
  - Broker runtime logs are timestamped to stdout and `BROKER_LOG_PATH`, defaulting to `broker.log`; new submissions log a clear `NEW SUBMISSION from <reporter>` line and the full raw XMTP JSON payload, including private detail bodies.
  - The `run` command requires a writable local Kubo IPFS API and fails startup if the Kubo version or add probe fails.
  - `./run-broker.sh debug` enables Python DEBUG logging, Python fault-handler output, Rust XMTP backtraces, `RUST_LOG=debug`, and a default `broker-debug.log`.
  - Signal support is optional. When `BROKER_SIGNAL_CLI` is unset, the broker validates XMTP submissions and records accepted submissions locally without Signal relay, reaction syncing, or reward settlement.
  - Signal relay messages include the report heading, public summary, private details, and BugBundle URI, but omit unused repro, evidence, and contact-hint placeholder sections.
  - The broker dependencies are pinned to `xmtp==0.1.5` and `xmtp-bindings==0.1.5`.
  - Verify the actual broker virtualenv with `.venv-broker/bin/python -m pip show xmtp xmtp-bindings xmtp-agent` before assuming the runtime matches the requested pin.
  - The broker runner keeps guarded native compatibility shims for accidental `xmtp-bindings` drift that changes wrapper-call signatures or renamed bindings symbols, avoiding a local XMTP DB wipe for package mismatch debugging.
  - The broker persists and reuses its XMTP installation DB, archives inbox-mismatched DB files before retrying startup, and archives/retries when the local installation ID is no longer present in the network inbox state. If the installation count is already at `BROKER_XMTP_INSTALLATION_LIMIT` before registration, the broker revokes stale installations first so a new local DB can recover instead of failing at the network limit.
  - `BROKER_XMTP_ARCHIVE_INACTIVE_DB` defaults to enabled. Disable it only for manual debugging of a local XMTP DB whose installation is absent from the network inbox state.
  - `BROKER_XMTP_AUTO_REVOKE_OLD_INSTALLATIONS` defaults to enabled. Disable it only for intentional multi-installation broker operations.
  - The broker runner patches XMTP agent stream shutdown so a stream error cannot recursively cancel the currently running stream task and hide the original error.
  - `BROKER_KEY` is the single broker wallet key, used for the XMTP identity and BUGZ payouts.
  - `BROKER_DRY_RUN` defaults to `1` in `run-broker.sh`; while enabled, accepted submissions verify and pin but skip the `publishBug` transaction and Signal relay. Set it to `0` only when the broker wallet is intentionally funded for live index publishing and payouts.
  - Broker verification may normalize EVM addresses to lowercase internally, but `bots/cheapbugs_broker/bug_index.py` converts ABI `address` arguments to checksum form before calling web3.py contract functions.
  - SQLite tracks processed XMTP message IDs, relayed submissions, BugBundle CIDs and details keys, Signal message timestamps, active reactions, settlement status, reward amounts, and payout transaction hashes.
  - SQLite also tracks detail-unlock quotes by request id, report hash, buyer, quoted price, expiry, and fulfilled transaction hash so payment confirmation cannot be faked with buyer-supplied amounts.
  - Signal access requests are gated by `BROKER_ACCESS_MIN_BUGZ` for the authenticated XMTP sender wallet. Optional `wallet` fields must match that sender, and spoofed wallet claims are rejected before BUGZ balance checks or Signal invites.
  - Live payouts spend from the broker wallet and should run only from an intentionally funded wallet.
- **Test Criteria**:
  - [x] `python3 -m unittest discover -s bots/tests -t bots` covers command parsing, staged broker validation, access wallet/sender binding, detail-unlock quote/payment verification, SQLite maturity, reaction parsing, and reward math.
  - [x] Broker tests cover XMTP installation pruning, inactive local installation detection, and maxed-installation recovery.
  - [x] `python3 -m compileall bots scripts/broker-bot.py` checks Python syntax.
  - [x] `bash -n run-broker.sh` checks the root launcher syntax.
  - [x] Add website-to-XMTP JSON command tests for publisher, seller, and bouncer flows.
  - [ ] Add integration smoke tests with a disposable XMTP wallet and Signal group before production broker launch.

### EAS Reviewer Verdicts

- **Stability**: in-progress
- **Description**: Reviewers write verdict attestations to EAS on Base; the frontend reads verdict state from EAS GraphQL.
- **Properties**:
  - `@ethereum-attestation-service/eas-sdk` is intentionally not used because it pulled Hardhat-era dependencies into npm audit.
  - Writes use direct ethers contract calls in `src/attest/eas.ts`.
  - `ReviewVerdict` is active; `PayoutRecord` remains a placeholder for future public payout records.
  - Report detail pages show latest EAS verdict attestations in the trusted review panel with a trust column, while the headline state and confidence average still use only `VITE_REVIEWER_ADDRESSES`.
  - Report detail pages do not show raw CheapBugs contract-suite addresses in the report metadata table.
- **Test Criteria**:
  - [x] `npm run build` type-checks EAS reads/writes.
  - [x] Playwright covers a mocked report detail page with EAS verdict rows, hidden contract addresses, and `unlock details` copy.
  - [ ] Add browser tests for mocked verdict submission once schema UIDs are stable in test config.

### BUGZ Token And Trading

- **Stability**: in-progress
- **Description**: The `/token` route reads BUGZ balances and performs browser-signed Uniswap v4 buy/sell swaps on Base.
- **Properties**:
  - BUGZ defaults to Base token `0x60Df4a0C9A5050c337010cb29C9694cE4d8fbb07`.
  - Base contract read providers disable JSON-RPC batching and use a static network so public Base RPC endpoints do not reject oversized batches during concurrent header/token reads.
  - Buy/sell uses the Clanker-created Uniswap v4 WETH/BUGZ pool key, v4 Quoter, and Universal Router 2.1.1.
  - Buy/sell quote previews refresh automatically after a short pause in amount or slippage edits. Quote reads do not require a connected wallet; submitting trades still requires a connected wallet and re-quotes before sending.
  - Buy wraps ETH through the router; sell requires ERC20 plus Permit2 approvals.
  - Buy/sell and other onchain write flows show a shared wallet-request modal while CheapBugs is waiting for wallet approval and Base confirmation. The modal has a cancel button that stops the app from waiting; users still need to reject any open wallet prompt to cancel the wallet request itself.
  - Trading does not depend on `VITE_BUGZ_TREASURY_ADDRESS`.
- **Test Criteria**:
  - [x] `npm run build` type-checks trade adapters.
  - [x] Playwright covers debounced automatic quote refresh for the token trade form with mocked Base RPC.
  - [x] Playwright covers the token buy transaction opening the shared wallet-request modal and local cancel behavior with mocked Base RPC.

### Patrons Leaderboard

- **Stability**: in-progress
- **Description**: `/patrons` shows a daily-cached BUGZ holder leaderboard using Etherscan V2 holder data when configured, with a Base RPC Transfer-log fallback.
- **Properties**:
  - Holder snapshots cache in localStorage for 24 hours.
  - The home page does not render a patrons preview; holder scans stay isolated to `/patrons`.
  - The RPC fallback reads 10,000-block Transfer-log pages from `VITE_BUGZ_TOKEN_DEPLOYMENT_BLOCK`.
  - RPC failures render setup guidance for `VITE_ETHERSCAN_API_KEY` or `VITE_BASESCAN_API_KEY`.
- **Test Criteria**:
  - [x] Playwright covers RPC-safe paging, cache reuse, manual refresh, and API-key guidance.

### Cloudflare Pages Deployment

- **Stability**: stable
- **Description**: Cloudflare Pages builds `dist/` from the GitHub repo for the `cheapbugs.net` custom domain.
- **Properties**:
  - The Cloudflare Pages project is `cheapbugs`, connected to `pierce403/cheapbugs` on the `main` production branch.
  - The build command is `npm run build`, the output directory is `dist`, and Node is pinned by `.node-version`.
  - The Cloudflare `cheapbugs.net` zone routes the apex through a proxied CNAME to `cheapbugs.pages.dev`.
  - Production custom-domain deployments use root-relative Vite base paths.
  - Hash routing is supported for SPA compatibility.
  - Only set `VITE_BASE_PATH` when deploying under a non-root subpath.
- **Test Criteria**:
  - [x] Cloudflare Pages is connected to the GitHub repo with `VITE_BASE_PATH=/` and `VITE_ROUTER_MODE=hash`.
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
- **CheapBugsBondVault / CheapBugsTreasuryVault**: onchain BUGZ bonding, detail-key purchase accounting, and ordered reporter reward disbursement.
- **Thirdweb**: installed-wallet login, WalletConnect QR, signer adapters.
- **ENS**: mainnet name/avatar resolution for session UI.
- **IPFS / Pinata**: encrypted dossier storage and gateway reads.
- **EAS**: reviewer verdict attestations and indexed reads.
- **XMTP**: browser-to-broker report submission and broker status messages.
- **Signal**: private reviewer channel relay and reaction source.
- **Dex Screener / Uniswap v4 / Clanker**: treasury BUGZ/USD price display and browser-signed BUGZ market trading.
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
python3 -m unittest discover -s bots/tests -t bots
python3 -m compileall bots scripts/broker-bot.py
```

## Future Milestones

- Wire accepted broker submissions to call `CheapBugsBugIndex.publishBug` after IPFS pinning.
- Replace the broker bot's direct wallet-funded payout path with the index-ordered `CheapBugsTreasuryVault` reward path.
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
- **Date of Last Update**: 2026-05-18
