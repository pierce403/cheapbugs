# CheapBugs

CheapBugs is a static Vite + TypeScript app for Base-native bug intake and review.

The current MVP stores public-safe report records onchain in `CheapBugsBugIndex` on Base, keeps the private dossier encrypted client-side before uploading it to IPFS, and uses EAS on Base for reviewer verdict attestations and payout-record placeholders.

The repo now also includes an XMTP broker path for a private-review workflow: the static site can generate a local XMTP wallet, send strict JSON submissions by XMTP DM to the default broker wallet, and the Python broker can validate, acknowledge, and relay reports into a private Signal group, gate access and submissions by BUGZ balance, count Signal reactions after seven days, and pay BUGZ rewards from a funded payout wallet.

BUGZ is live on Base at `0x60Df4a0C9A5050c337010cb29C9694cE4d8fbb07`. The static app reads connected-wallet balances directly from Base and exposes buy/sell controls as browser-signed Uniswap v4 transactions against the Clanker-created market. There is no token backend.

The frontend now reserves first-class routes for `index`, `submit`, `review`, `token`, and `patrons`. The token screen is live by default for BUGZ; the patrons screen uses a daily-cached holder API when configured and otherwise falls back to Transfer-log scans from the BUGZ deployment block.

For contract development, the repo now also includes a Foundry workspace with a deploy script and scenario tests for bug submission and reviewer vote flows. The current verified Base deployment is `CheapBugsBugIndex` at `0x515FDbc9876aC26870794E26605c7DD04c18679b`, `CheapBugsBondVault` at `0x2Eab99B6d6F1FBDa4fa78a00662E0cf9aBd9f3d3`, and `CheapBugsTreasuryVault` at `0x4A080668d9848928dc6D48921cbDc4273fe27A9d`.

## What Is In Scope

- Thirdweb wallet login with injected browser wallet and WalletConnect QR fallback
- Base-only onchain report index contract
- encrypted private report uploads to IPFS
- EAS review verdict attestations
- public browsing, report pages, and reviewer queue
- static deployment with no backend database
- optional XMTP broker bot runtime for private Signal review and BUGZ rewards

## What Is Not In Scope Yet

- app-hosted token sale backend
- treasury logic
- Compound integration
- DAO governance
- onchain treasury-managed payout execution

## XMTP Broker Flow

The submit route defaults to XMTP DM submission through `0xea6995fc3674e1e94736766f5eeefb0506e4ef32`; set `VITE_BROKER_XMTP_ADDRESS` only when overriding that broker wallet. Users can connect with an existing browser wallet, scan a WalletConnect QR code, or create a site-local XMTP wallet; generated wallet keys are stored in this browser and can be copied from `/login` for recovery.

Submissions are sent as a strict `cheapbugs.bug_submission.v1` JSON object. The site currently asks only for title, public summary, and private details; the broker owns review-key generation and fills omitted triage metadata internally. The broker rejects malformed JSON, missing core fields, invalid provided target references, or reporters that fail the configured submission credential checks. When the checks pass, it replies over XMTP that the JSON is valid, the fields are well formed, the target is valid, and the reporter credentials are valid before relaying the submission.

Bot setup:

```bash
./run-broker.sh
```

`run-broker.sh` loads a shell-compatible `.env`, prepares `.venv-broker`, installs `requirements-broker.txt`, initializes the SQLite store, and starts the broker. It expects `xmtp==0.1.5` and `BROKER_KEY`. `BROKER_KEY` is the broker wallet key used for both the XMTP identity and BUGZ payouts. Base RPC and BUGZ token settings default to Base mainnet and the live BUGZ token, and can be overridden with `BASE_RPC_URL` and `BUGZ_TOKEN_ADDRESS`. `BROKER_DRY_RUN` defaults to `1`, which prevents token transfers while still exercising the validation path; set `BROKER_DRY_RUN=0` only when the broker wallet is intentionally funded. Broker events are timestamped to stdout and `broker.log` by default; set `BROKER_LOG_PATH` to override the log file.

For crash/debug runs, use:

```bash
./run-broker.sh debug
```

Debug mode sets Python logging to `DEBUG`, enables Python fault-handler output, enables Rust backtraces for XMTP panics, and writes to `broker-debug.log` unless `BROKER_LOG_PATH` is already set.

Signal is optional for local broker testing. If `BROKER_SIGNAL_CLI` is unset, `run-broker.sh` prints a warning and starts the broker without Signal relay, Signal reaction syncing, or reward settlement.

Minimal `.env` shape:

```bash
BROKER_KEY=0x...
BROKER_DRY_RUN=1
```

Optional Signal relay:

```bash
BROKER_SIGNAL_CLI=/path/to/signal-cli
BROKER_SIGNAL_ACCOUNT=+15555550123
BROKER_SIGNAL_GROUP_ID=...
```

## BUGZ Trading

The default BUGZ token is `0x60Df4a0C9A5050c337010cb29C9694cE4d8fbb07` on Base. The `/token` route is still static HTML/TypeScript: it uses the Clanker WETH/BUGZ Uniswap v4 pool key, quotes through the v4 Quoter, and submits Universal Router 2.1.1 transactions from the connected wallet. Buy wraps ETH to WETH inside the router, swaps for BUGZ, and sends BUGZ to the wallet. Sell may first request ERC20 and Permit2 approvals, swaps BUGZ to WETH, and unwraps to ETH for the connected wallet. No treasury address is needed for trading.

## Quick Start

1. Install dependencies:

```bash
npm install
git submodule update --init --recursive
```

If you want the Solidity toolchain locally, make sure `forge` is installed and on your `PATH`.

2. Create local env config:

```bash
cp .env.example .env.local
```

3. Fill the required values in `.env.local`:

- `VITE_BUG_INDEX_ADDRESS` only when overriding the committed Base bug index default
- optional `VITE_BUGZ_TOKEN_ADDRESS`, `VITE_BUGZ_TOKEN_DEPLOYMENT_BLOCK`, `VITE_ETHERSCAN_API_KEY` or `VITE_BASESCAN_API_KEY`, `VITE_BUGZ_MARKET_URL`, `VITE_BUGZ_HOLDERS_URL`, and `VITE_BUGZ_V4_*` overrides for the token dashboard, daily-cached patrons board, and static trade pool. `VITE_BUGZ_TREASURY_ADDRESS` overrides the committed Base treasury vault used for treasury display rows.
- optional `VITE_THIRDWEB_CLIENT_ID` override for Thirdweb wallet login. A public default client id is committed for static deploys.
- optional `VITE_BROKER_XMTP_ADDRESS` override when submissions should go to a non-default XMTP broker wallet
- `VITE_REVIEW_VERDICT_SCHEMA_UID` after registering the EAS schema
- `VITE_REVIEWER_ADDRESSES` for trusted reviewers

4. Dry-run the contract launcher:

```bash
npm run launch:bug-index:dry-run
npm run launch:bug-index:forge:dry-run
npm run contracts:test
npm run test:e2e
```

5. Deploy the Base CheapBugs contract suite when ready:

```bash
npm run launch:bug-index
```

Real deployments verify `CheapBugsTreasuryVault`, `CheapBugsBondVault`, and `CheapBugsBugIndex` on Etherscan/BaseScan by default after the script checks deployed wiring. Set `ETHERSCAN_API_KEY` or `BASESCAN_API_KEY`; use `BUG_INDEX_VERIFY_CONTRACTS=0` only when intentionally skipping verification.

The launchers use `BUG_INDEX_DEPLOYER_PRIVATE_KEY` when set, otherwise they deploy from `BROKER_KEY`, seed that broker as the initial broker when no broker list is provided, and transfer ownership to `0x7ab874Eeef0169ADA0d225E9801A3FfFfa26aAC3` by default.

6. Start the app:

```bash
npm run dev
```

7. Build static assets:

```bash
npm run build
```

## GitHub Pages

This repo is intended to deploy through GitHub Actions to GitHub Pages.

Set these repository variables before relying on the Pages deploy:

- `VITE_BUG_INDEX_ADDRESS` when the Base bug index is deployed
- `VITE_REVIEW_VERDICT_SCHEMA_UID` when the verdict schema is registered
- optional chain and storage overrides from [.env.example](.env.example)

The workflow lives at [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml).
It builds with `VITE_BASE_PATH=/` for the `cheapbugs.net` custom domain and `hash` routing so GitHub Pages can serve SPA routes without a custom origin server.
Set `VITE_THIRDWEB_CLIENT_ID` as a repository variable only if the hosted site should use a different Thirdweb client id.

## How Reports Work

1. A reporter connects through Thirdweb with an injected browser wallet, scans a WalletConnect QR code, or uses a site-local XMTP wallet.
2. The browser encrypts private details into a `cheapbugs.bug_bundle.v1`.
3. The reporter signs a `PublishBug` EIP-712 authorization over the bundle hash and report commitments.
4. The browser sends the encrypted bundle, publish authorization, and out-of-bundle details key to the broker over XMTP.
5. The broker verifies the authorization and pins the encrypted bundle to IPFS.
6. The public-safe report record can be written onchain to `CheapBugsBugIndex` on Base by the authorized broker.
7. Reviewers publish verdicts as EAS onchain attestations on Base.
8. The frontend reads the bug index contract for reports and the EAS GraphQL API for verdicts.

By default, the submit route sends a minimal strict JSON XMTP DM to the broker wallet. The broker validates the JSON shape, publish authorization, target reference, BUGZ submission balance, and local reputation blocklist, then pins the encrypted bundle to IPFS and records the submission. The older direct broker-wallet reward adapter still exists, but the contract direction is ordered payouts through `CheapBugsTreasuryVault`.

## Environment Notes

- Thirdweb wallet sessions are remembered in browser local storage and restored after refresh when the wallet still authorizes the site.
- WalletConnect QR login is handled by Thirdweb and uses `VITE_THIRDWEB_CLIENT_ID`; the committed default can be overridden per deployment.
- Do not place Pinata API keys in browser code.
- Pinata is supported only through a presigned upload endpoint.
- Without a Pinata presign endpoint, the default IPFS gateway provider can read existing IPFS JSON but cannot upload new legacy onchain dossiers.
- ENS identity lookups use Ethereum mainnet RPC and can be overridden with `VITE_ENS_RPC_URL`.
- Site-generated XMTP wallets are stored locally in the browser under `cheapbugs.localXmtpIdentity.v1`; users must keep the copied recovery key if that wallet will hold BUGZ.
- Base-specific values are isolated in [src/config/chains.ts](src/config/chains.ts) and [src/config/env.ts](src/config/env.ts).

## Contract Launchers

The launcher script is [scripts/launch-bug-index.mjs](scripts/launch-bug-index.mjs).

For Solidity-native deployment and testing, the repo also includes [foundry.toml](foundry.toml), [script/LaunchBugIndex.s.sol](script/LaunchBugIndex.s.sol), and [test/CheapBugsBugIndex.t.sol](test/CheapBugsBugIndex.t.sol).

The CheapBugs contract launcher:

- compiles [contracts/CheapBugsBugIndex.sol](contracts/CheapBugsBugIndex.sol)
- compiles [contracts/CheapBugsBondVault.sol](contracts/CheapBugsBondVault.sol)
- compiles [contracts/CheapBugsTreasuryVault.sol](contracts/CheapBugsTreasuryVault.sol)
- writes `artifacts/CheapBugsBugIndex.json`
- writes `artifacts/CheapBugsBondVault.json`
- writes `artifacts/CheapBugsTreasuryVault.json`
- writes tracked reproducibility manifests and full generated contract artifacts under [deployments/](deployments/)
- refreshes [src/contracts/bugIndexAbi.ts](src/contracts/bugIndexAbi.ts) so the frontend ABI stays aligned with the deployed contract
- deploys and wires the bond vault, treasury vault, and index together
- verifies real deployments on Etherscan/BaseScan by default
- uses the live Base BUGZ token address hardcoded in the vault contracts

## Key Paths

- [contracts/CheapBugsBugIndex.sol](contracts/CheapBugsBugIndex.sol)
- [contracts/CheapBugsBondVault.sol](contracts/CheapBugsBondVault.sol)
- [contracts/CheapBugsTreasuryVault.sol](contracts/CheapBugsTreasuryVault.sol)
- [scripts/launch-bug-index.mjs](scripts/launch-bug-index.mjs)
- [scripts/launch-bug-index-forge.sh](scripts/launch-bug-index-forge.sh)
- [script/LaunchBugIndex.s.sol](script/LaunchBugIndex.s.sol)
- [test/CheapBugsBugIndex.t.sol](test/CheapBugsBugIndex.t.sol)
- [src/contracts/bugIndex.ts](src/contracts/bugIndex.ts)
- [src/contracts/bugzTokenAbi.ts](src/contracts/bugzTokenAbi.ts)
- [src/auth/thirdweb.ts](src/auth/thirdweb.ts)
- [src/auth/localIdentity.ts](src/auth/localIdentity.ts)
- [FEATURES.md](FEATURES.md)
- [src/xmtp/browser.ts](src/xmtp/browser.ts)
- [src/xmtp/broker.ts](src/xmtp/broker.ts)
- [scripts/broker-bot.py](scripts/broker-bot.py)
- [bots/cheapbugs_broker/](bots/cheapbugs_broker)
- [src/storage/gateway.ts](src/storage/gateway.ts)
- [src/storage/pinata.ts](src/storage/pinata.ts)
- [src/attest/eas.ts](src/attest/eas.ts)
- [src/lib/reports.ts](src/lib/reports.ts)
- [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml)

## References

- Thirdweb TypeScript SDK: https://portal.thirdweb.com/typescript/v5
- Pinata presigned uploads: https://docs.pinata.cloud/files/presigned-urls
- EAS indexing service repo: https://github.com/ethereum-attestation-service/eas-indexing-service
- IPFS web app guidance: https://docs.ipfs.tech/how-to/ipfs-in-web-apps/
