# Architecture Overview

This document is a living system map for CheapBugs. It is intended to help agents and contributors understand where major responsibilities live, how data moves through the app, and which boundaries should remain stable as the project evolves.

Update this file whenever the codebase's architecture, deployment assumptions, integrations, or navigation map materially change.

## 1. Project Structure

The repository is a static Vite application with two Solidity contracts, both Node and Foundry deployment scripts, a Foundry test suite, a modular TypeScript frontend, and an optional Python bouncer bot for XMTP-to-Signal private review.

```text
cheapbugs/
├── bots/                   # Python bouncer bot package and tests
├── contracts/              # Solidity contracts, currently the Base bug index and BUGZ token contracts
├── script/                 # Foundry deployment scripts
├── scripts/                # Deployment and maintenance scripts
├── test/                   # Foundry contract tests
├── lib/                    # Foundry libraries
├── public/                 # Static assets and SPA hosting helpers
├── src/
│   ├── attest/             # EAS write adapters
│   ├── auth/               # injected wallet, WalletConnect QR, and local XMTP identity helpers
│   ├── config/             # chain, env, and reviewer configuration
│   ├── contracts/          # frontend contract ABI and adapters
│   ├── lib/                # core domain logic, crypto, IPFS, caching, utilities
│   ├── storage/            # storage-provider implementations
│   ├── types/              # domain and integration types
│   ├── xmtp/               # browser XMTP identity and bouncer DM helpers
│   └── views/              # route-level UI rendering
├── README.md               # setup and high-level overview
├── DEPLOY.md               # deployment workflow
├── TODO.md                 # known follow-up work
├── AGENTS.md               # coding-agent instructions
└── ARCHITECTURE.md         # this document
```

## 2. High-Level System Diagram

```text
[Reporter / Reviewer Browser]
        |
        v
[Static Vite Frontend]
  |        |         |
  |        |         +--> [EAS on Base] <--> [EAS GraphQL API]
  |        |
  |        +--------------> [IPFS via gateway reads or Pinata presigned upload]
  |
  +-----------------------> [CheapBugsBugIndex on Base]
  |
  +-----------------------> [BUGZ + Uniswap v4 on Base]

[Reporter Browser] --XMTP DM--> [Bouncer Bot] --signal-cli--> [Private Signal Group]
                                      |
                                      +--> [BUGZ ERC20 on Base]
```

System boundaries:

- The frontend is the only application runtime. There is no backend database or SSR layer.
- Public-safe report metadata is stored onchain in the bug index contract.
- Sensitive report details are encrypted client-side before they leave the browser.
- Reviewer verdicts are onchain EAS attestations but are read via the EAS GraphQL API in the frontend.
- When `VITE_BOUNCER_XMTP_ADDRESS` is configured, report submission uses browser XMTP DMs to the bouncer instead of the legacy onchain/IPFS filing path.
- The bouncer bot is an optional off-static runtime with its own SQLite state; it does not add a backend database to the hosted frontend.

## 3. Core Components

### 3.1. Frontend Application

Name: CheapBugs static web app

Description: A narrow-layout, milw0rm-inspired frontend for Thirdweb wallet login, report submission, public browsing, report review, live BUGZ balance/trading controls, a patrons leaderboard, and local decryption of private dossiers.

Technologies: Vite, TypeScript, vanilla HTML/CSS/TS modules, ethers, Thirdweb, viem, optional `@xmtp/browser-sdk`

Deployment: Static assets from `dist/`, suitable for Netlify, Cloudflare Pages, Vercel static hosting, GitHub Pages, or IPFS-aware static hosting

### 3.2. Onchain Report Index

Name: `CheapBugsBugIndex`

Description: The canonical onchain index for public-safe report records on Base. It stores immutable report metadata and provides basic retrieval of individual and recent reports.

Technologies: Solidity 0.8.24, Base, ethers/viem integration from the frontend

Deployment: Deployed with [scripts/launch-bug-index.mjs](/home/pierce/projects/cheapbugs/scripts/launch-bug-index.mjs) or [script/LaunchBugIndex.s.sol](/home/pierce/projects/cheapbugs/script/LaunchBugIndex.s.sol)

Additional Notes: The contract now also includes reviewer-only onchain review-vote storage and query helpers for contract-level validation and future extensions, while the current frontend still treats EAS as the source of truth for public review state.

### 3.3. Optional Token Contract

Name: `CheapBugsToken`

Description: The original standalone ERC20 extension contract remains in the repo, but the live BUGZ token used by the frontend is the Base token deployed through Clanker at `0x60Df4a0C9A5050c337010cb29C9694cE4d8fbb07`.

Technologies: Solidity 0.8.24, OpenZeppelin ERC20, Base, viem deployment tooling

Deployment: Deployed with [scripts/launch-token.mjs](/home/pierce/projects/cheapbugs/scripts/launch-token.mjs)

### 3.4. Attestation Layer

Name: EAS integration

Description: Handles onchain reviewer verdict attestations and a placeholder payout record schema. Reads are performed through EAS GraphQL; writes use the EAS SDK from the connected wallet.

Technologies: `@ethereum-attestation-service/eas-sdk`, Base EAS contracts, EAS GraphQL API

Deployment: External network dependency on Base EAS contracts and EAS Scan indexing infrastructure

### 3.5. Storage Layer

Name: StorageProvider abstraction

Description: Provides pluggable upload/download support for encrypted dossier JSON and optional public reviewer notes. The default gateway provider can read IPFS JSON but cannot upload; Pinata is available only behind a presigned-upload helper.

Technologies: Pinata presigned uploads, IPFS gateways

Deployment: Browser-side integration; no app-owned storage server in the MVP

### 3.6. XMTP Bouncer Bot

Name: CheapBugs bouncer

Description: Optional Python runtime that receives XMTP DMs at a static bouncer wallet, relays structured submissions into a private Signal group with `signal-cli`, records relayed Signal message timestamps and reactions in SQLite, token-gates channel access by BUGZ balance, and transfers BUGZ rewards from a funded payout wallet after the review window.

Technologies: Python 3.10+, `xmtp==0.1.5`, `web3.py`, `signal-cli`, SQLite

Deployment: Long-running worker or cron-friendly process outside the static site. The bouncer wallet uses `XMTP_WALLET_KEY`; live payouts require `BUGZ_PAYOUT_PRIVATE_KEY` and a funded BUGZ holder wallet.

## 4. Data Stores

### 4.1. Onchain Report Store

Name: Base bug index contract

Type: EVM smart contract storage

Purpose: Stores public-safe `SubmissionPublic` fields, including the encrypted payload CID, reporter, timestamps, and hashed target reference.

Key Records:

- submission records keyed by `reportHash`
- reviewer allowlist entries in the contract for future use
- recent report hash ordering

### 4.2. IPFS Blob Store

Name: Encrypted dossier storage

Type: IPFS content-addressed object storage

Purpose: Stores encrypted `SubmissionPrivate` payloads and optional reviewer note JSON blobs.

Key Objects:

- encrypted private dossier JSON
- optional reviewer note JSON

### 4.3. Attestation Store

Name: EAS on Base

Type: Onchain attestation registry plus indexed GraphQL read model

Purpose: Stores `ReviewVerdict` attestations and future `PayoutRecord` attestations.

Key Schemas:

- `ReviewVerdict`
- `PayoutRecord`

### 4.4. Bouncer SQLite Store

Name: Bouncer ledger

Type: Local SQLite database

Purpose: Tracks processed XMTP message IDs, relayed submissions, Signal message timestamps, active Signal emoji reactions, settlement status, reward amounts, and payout transaction hashes.

Key Records:

- `submissions` keyed by bot-generated submission id
- `processed_xmtp_messages` for idempotency
- `signal_reactions` keyed by Signal group, target message timestamp, reactor, and emoji

## 5. External Integrations / APIs

Wallet Auth:

- Purpose: Connect Thirdweb installed wallets, prompt a local SIWE-style signature for external-wallet login, fall back to Thirdweb WalletConnect QR when browser web3 is unavailable or fails, restore authorized wallet sessions after refresh, and expose ethers signers to contract adapters
- Integration Method: [src/auth/thirdweb.ts](/home/pierce/projects/cheapbugs/src/auth/thirdweb.ts) with Thirdweb wallets, `thirdweb/adapters/ethers6`, and site-local XMTP identities from [src/auth/localIdentity.ts](/home/pierce/projects/cheapbugs/src/auth/localIdentity.ts)
- Persistence: The browser stores external wallet reconnect hints in `cheapbugs.walletSession.v1` and SIWE message/signature proofs in `cheapbugs.siweSession.v1`. The auth adapter also writes Thirdweb manager-compatible `thirdweb:*` localStorage keys after headless connects so `autoConnect()` can restore the active wallet after refresh.
- Configuration: `VITE_THIRDWEB_CLIENT_ID` overrides the committed public default Thirdweb client id. WalletConnect QR is handled through Thirdweb.
- Debugging: [src/lib/logger.ts](/home/pierce/projects/cheapbugs/src/lib/logger.ts) emits namespaced console breadcrumbs for auth clicks, Thirdweb provider choices, WalletConnect fallback, SIWE prompts, session restore, and failures.

ENS:

- Purpose: Resolve connected wallet ENS name and avatar for the session UI
- Integration Method: Browser-side Ethereum mainnet RPC reads in [src/lib/ens.ts](/home/pierce/projects/cheapbugs/src/lib/ens.ts), surfaced through [src/auth/thirdweb.ts](/home/pierce/projects/cheapbugs/src/auth/thirdweb.ts)
- Configuration: defaults to a public Ethereum mainnet RPC and allows `VITE_ENS_RPC_URL` overrides

EAS:

- Purpose: Onchain reviewer verdicts and placeholder payout attestations
- Integration Method: SDK writes in [src/attest/eas.ts](/home/pierce/projects/cheapbugs/src/attest/eas.ts), GraphQL reads in [src/lib/eas.ts](/home/pierce/projects/cheapbugs/src/lib/eas.ts)

Pinata:

- Purpose: Optional alternative IPFS upload provider
- Integration Method: Presigned upload URLs only, via [src/storage/pinata.ts](/home/pierce/projects/cheapbugs/src/storage/pinata.ts)

Base RPC:

- Purpose: Contract reads, writes, and deployment
- Integration Method: Configured in [src/config/env.ts](/home/pierce/projects/cheapbugs/src/config/env.ts) and consumed by the frontend and launchers

BUGZ Read And Trade Layer:

- Purpose: Read ERC20 metadata, connected-wallet balances, optional treasury display stats, patron balances, and browser-sign buy/sell swaps without requiring backend infrastructure
- Integration Method: [src/contracts/bugzToken.ts](/home/pierce/projects/cheapbugs/src/contracts/bugzToken.ts), [src/contracts/bugzTrade.ts](/home/pierce/projects/cheapbugs/src/contracts/bugzTrade.ts), and [src/lib/token.ts](/home/pierce/projects/cheapbugs/src/lib/token.ts)
- Trade Path: Configured Clanker WETH/BUGZ Uniswap v4 pool key, v4 Quoter reads, and Universal Router 2.1.1 transactions. Buys wrap ETH to WETH inside the router, swap to BUGZ, and send BUGZ to the wallet. Sells use ERC20 plus Permit2 approvals, swap BUGZ to WETH, and unwrap to ETH.
- Constraint: Buy/sell does not use a treasury address. `VITE_BUGZ_TREASURY_ADDRESS` only enables optional dashboard rows and should remain unset when there is no treasury to report.
- Constraint: Full patron enumeration depends on reconstructing balances from `Transfer` logs and therefore needs `VITE_BUGZ_TOKEN_DEPLOYMENT_BLOCK`.

Clanker:

- Purpose: Original BUGZ market creation and optional market page link
- Integration Method: The app does not call a Clanker backend. It treats the Clanker market as onchain Base liquidity and trades through Uniswap v4 contracts from the browser.

XMTP:

- Purpose: Browser-to-bouncer report submission and bouncer DM replies
- Integration Method: Browser sender in [src/xmtp/browser.ts](/home/pierce/projects/cheapbugs/src/xmtp/browser.ts) and Python bot runner in [bots/cheapbugs_bouncer/xmtp_runner.py](/home/pierce/projects/cheapbugs/bots/cheapbugs_bouncer/xmtp_runner.py)
- Configuration: `VITE_BOUNCER_XMTP_ADDRESS` for the frontend and `XMTP_WALLET_KEY`, `BOUNCER_XMTP_ENV`, and `BOUNCER_XMTP_DB_PATH` for the bot

Signal:

- Purpose: Private reviewer channel relay and reaction source for BUGZ reward scoring
- Integration Method: `signal-cli` subprocess adapter in [bots/cheapbugs_bouncer/signal_cli.py](/home/pierce/projects/cheapbugs/bots/cheapbugs_bouncer/signal_cli.py)
- Configuration: `BOUNCER_SIGNAL_ACCOUNT`, `BOUNCER_SIGNAL_GROUP_ID`, and `BOUNCER_SIGNAL_CLI`

Foundry:

- Purpose: Contract builds, scenario tests, and Solidity-native deployment
- Integration Method: [foundry.toml](/home/pierce/projects/cheapbugs/foundry.toml), [script/LaunchBugIndex.s.sol](/home/pierce/projects/cheapbugs/script/LaunchBugIndex.s.sol), and [test/CheapBugsBugIndex.t.sol](/home/pierce/projects/cheapbugs/test/CheapBugsBugIndex.t.sol)

## 6. Deployment & Infrastructure

Cloud Provider: Not fixed. The app is designed for generic static hosting.

Key Services Used:

- static asset host for `dist/`
- GitHub Pages
- optional worker host for `scripts/bouncer-bot.py`
- Base RPC endpoint
- Thirdweb wallet infrastructure, including WalletConnect QR
- EAS contracts and indexing
- IPFS storage/gateway infrastructure
- XMTP network
- Signal account and group reachable by `signal-cli`

CI/CD Pipeline: GitHub Actions builds and deploys `dist/` to GitHub Pages on pushes to `main`, with GitHub Pages configured for workflow-based publishing, a root `/` asset base for the `cheapbugs.net` custom domain, hash routing, and optional `VITE_THIRDWEB_CLIENT_ID`

Monitoring & Logging: Browser console and wallet/provider errors only in the current MVP

## 7. Security Considerations

Authentication:

- Thirdweb installed-wallet connect
- Thirdweb WalletConnect QR connect
- site-generated local XMTP wallet using a browser-stored EVM private key

Authorization:

- reviewer UI trust is currently determined by a frontend allowlist in [src/config/reviewers.ts](/home/pierce/projects/cheapbugs/src/config/reviewers.ts)
- report submission requires a connected wallet on Base
- bouncer submissions require an XMTP-capable identity
- private Signal access requests require the requested wallet to hold at least `BOUNCER_ACCESS_MIN_BUGZ`
- BUGZ buy/sell actions require a connected transaction signer, either a Thirdweb external wallet or the browser-stored local wallet with Base ETH for gas

Data Encryption:

- private dossier content is encrypted in the browser before IPFS upload
- transport security depends on HTTPS and wallet/provider infrastructure
- XMTP bouncer submissions are private to the XMTP DM and then relayed to Signal; they are not encrypted into IPFS by the static app path

Key Security Practices:

- never place Pinata API credentials in browser code
- treat all IPFS and EAS note content as untrusted input
- store only redacted/public-safe metadata onchain
- treat Signal reaction counts as social support signals, not sybil-resistant votes
- do not run live bouncer payouts without a funded wallet whose loss exposure is intentionally capped
- browser-generated local XMTP wallet keys are recoverable only from the same browser unless the user copies the recovery key

## 8. Development & Testing Environment

Local Setup Instructions:

- install dependencies with `npm install`
- sync the Foundry library submodule with `git submodule update --init --recursive`
- install `forge` if you want the Solidity-native build, test, or launch path
- copy `.env.example` to `.env.local`
- optionally set `VITE_THIRDWEB_CLIENT_ID` to override the default Thirdweb client id or override `VITE_ENS_RPC_URL`
- deploy the bug index contract or set `VITE_BUG_INDEX_ADDRESS`
- BUGZ defaults to the Base Clanker token at `0x60Df4a0C9A5050c337010cb29C9694cE4d8fbb07`
- optionally configure the BUGZ deployment block, market URL, and `VITE_BUGZ_V4_*` pool overrides when `/patrons` scans or a different Clanker market should become live. `VITE_BUGZ_TREASURY_ADDRESS` is only for optional dashboard stats.
- optionally set `VITE_BOUNCER_XMTP_ADDRESS` and run `python scripts/bouncer-bot.py run` when the XMTP/Signal submission path should be live

Testing / Verification Commands:

- `npm run dev`
- `npm run build`
- `npm run contracts:build`
- `npm run contracts:test`
- `npm run launch:bug-index:dry-run`
- `npm run launch:bug-index:forge:dry-run`
- `npm run launch:token:dry-run`
- `python3 -m unittest discover -s bots/tests -t bots`
- `python3 -m compileall bots scripts/bouncer-bot.py`
- GitHub Actions Pages workflow in `.github/workflows/deploy-pages.yml`

Code Quality Tools:

- TypeScript strict mode
- Vite production build
- manual architectural documentation in `AGENTS.md` and `ARCHITECTURE.md`

## 9. Future Considerations / Roadmap

- Replace the frontend reviewer allowlist with an onchain reviewer registry or resolver-backed trust model.
- Add public payout records for bouncer settlements while keeping `PayoutRecord` as the public record layer.
- Keep BUGZ trading static/client-side; do not introduce a backend market proxy.
- Add patron leaderboard and governance as separate extensions.
- Reduce WalletConnect/XMTP bundle size with route or adapter-level code splitting.
- Add automated CI and ABI drift checks.

## 10. Project Identification

Project Name: CheapBugs

Repository URL: `git@github.com:pierce403/cheapbugs.git`

Primary Contact/Team: `pierce403`

Date of Last Update: 2026-05-17

## 11. Glossary / Acronyms

Base: The default EVM chain used by the app and contract deployment flow.

Bug Index: The onchain `CheapBugsBugIndex` contract that stores public-safe report metadata.

CID: A content identifier used to locate IPFS-hosted content.

EAS: Ethereum Attestation Service.

IPFS: InterPlanetary File System, used here for encrypted dossier and note storage.

SubmissionPrivate: The sensitive report payload that must be encrypted before upload.

SubmissionPublic: The redacted public record written onchain.
