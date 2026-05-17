# CheapBugs

CheapBugs is a static Vite + TypeScript app for Base-native bug intake and review.

The current MVP stores public-safe report records onchain in `CheapBugsBugIndex` on Base, keeps the private dossier encrypted client-side before uploading it to IPFS, and uses EAS on Base for reviewer verdict attestations and payout-record placeholders.

The repo now also includes an XMTP bouncer path for a private-review workflow: the static site can generate a local XMTP wallet, send strict JSON submissions by XMTP DM to the default bouncer wallet, and the Python bouncer can validate, acknowledge, and relay reports into a private Signal group, gate access and submissions by BUGZ balance, count Signal reactions after seven days, and pay BUGZ rewards from a funded payout wallet.

BUGZ is live on Base at `0x60Df4a0C9A5050c337010cb29C9694cE4d8fbb07`. The static app reads connected-wallet balances directly from Base and exposes buy/sell controls as browser-signed Uniswap v4 transactions against the Clanker-created market. There is no token backend.

The frontend now reserves first-class routes for `index`, `submit`, `review`, `token`, and `patrons`. The token screen is live by default for BUGZ; the patrons screen uses a daily-cached holder API when configured and otherwise falls back to Transfer-log scans from the BUGZ deployment block.

For contract development, the repo now also includes a Foundry workspace with a deploy script and scenario tests for bug submission and reviewer vote flows.

## What Is In Scope

- Thirdweb wallet login with injected browser wallet and WalletConnect QR fallback
- Base-only onchain report index contract
- encrypted private report uploads to IPFS
- EAS review verdict attestations
- public browsing, report pages, and reviewer queue
- static deployment with no backend database
- optional XMTP bouncer bot runtime for private Signal review and BUGZ rewards

## What Is Not In Scope Yet

- app-hosted token sale backend
- treasury logic
- Compound integration
- DAO governance
- onchain treasury-managed payout execution

## XMTP Bouncer Flow

The submit route defaults to XMTP DM submission through `0xea6995fc3674e1e94736766f5eeefb0506e4ef32`; set `VITE_BOUNCER_XMTP_ADDRESS` only when overriding that broker wallet. Users can connect with an existing browser wallet, scan a WalletConnect QR code, or create a site-local XMTP wallet; generated wallet keys are stored in this browser and can be copied from `/login` for recovery.

Submissions are sent as a strict `cheapbugs.bug_submission.v1` JSON object. The bouncer rejects malformed JSON, missing fields, invalid target references, or reporters that fail the configured submission credential checks. When the checks pass, it replies over XMTP that the JSON is valid, the fields are well formed, the target is valid, and the reporter credentials are valid before relaying the submission.

Bot setup:

```bash
python3 -m venv .venv-bouncer
source .venv-bouncer/bin/activate
pip install -r requirements-bouncer.txt
python scripts/bouncer-bot.py init-db
BOUNCER_DRY_RUN=1 python scripts/bouncer-bot.py run
```

The bot expects `xmtp==0.1.5`, `signal-cli`, a Signal account already joined/admin in the private group, `BUGZ_TOKEN_ADDRESS`, `BASE_RPC_URL`, `XMTP_WALLET_KEY`, and `BUGZ_PAYOUT_PRIVATE_KEY` for live payouts. `BOUNCER_DRY_RUN=1` prevents token transfers while still exercising the relay and scoring path.

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

- `VITE_BUG_INDEX_ADDRESS` after deploying the contract
- optional `VITE_BUGZ_TOKEN_ADDRESS`, `VITE_BUGZ_TOKEN_DEPLOYMENT_BLOCK`, `VITE_ETHERSCAN_API_KEY` or `VITE_BASESCAN_API_KEY`, `VITE_BUGZ_MARKET_URL`, `VITE_BUGZ_HOLDERS_URL`, and `VITE_BUGZ_V4_*` overrides for the token dashboard, daily-cached patrons board, and static trade pool. `VITE_BUGZ_TREASURY_ADDRESS` is only for optional treasury display rows.
- optional `VITE_THIRDWEB_CLIENT_ID` override for Thirdweb wallet login. A public default client id is committed for static deploys.
- optional `VITE_BOUNCER_XMTP_ADDRESS` override when submissions should go to a non-default XMTP broker wallet
- `VITE_REVIEW_VERDICT_SCHEMA_UID` after registering the EAS schema
- `VITE_REVIEWER_ADDRESSES` for trusted reviewers

4. Dry-run the contract launcher:

```bash
npm run launch:bug-index:dry-run
npm run launch:token:dry-run
npm run launch:bug-index:forge:dry-run
npm run contracts:test
npm run test:e2e
```

5. Deploy the Base bug index contract when ready:

```bash
npm run launch:bug-index
```

Optional extension-token deployment for local experiments:

```bash
npm run launch:token
```

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
- optional chain and storage overrides from [.env.example](/home/pierce/projects/cheapbugs/.env.example)

The workflow lives at [.github/workflows/deploy-pages.yml](/home/pierce/projects/cheapbugs/.github/workflows/deploy-pages.yml).
It builds with `VITE_BASE_PATH=/` for the `cheapbugs.net` custom domain and `hash` routing so GitHub Pages can serve SPA routes without a custom origin server.
Set `VITE_THIRDWEB_CLIENT_ID` as a repository variable only if the hosted site should use a different Thirdweb client id.

## How Reports Work

1. A reporter connects through Thirdweb with an injected browser wallet, scans a WalletConnect QR code, or uses a site-local XMTP wallet.
2. The browser builds `SubmissionPrivate` and `SubmissionPublic`.
3. `SubmissionPrivate` is encrypted locally in the browser.
4. The encrypted private dossier is uploaded to IPFS through the configured storage provider.
5. The public-safe report record is written onchain to `CheapBugsBugIndex` on Base.
6. Reviewers publish verdicts as EAS onchain attestations on Base.
7. The frontend reads the bug index contract for reports and the EAS GraphQL API for verdicts.

By default, the submit route sends a strict JSON XMTP DM to the bouncer wallet. The bouncer validates the JSON shape, target reference, BUGZ submission balance, and local reputation blocklist, then relays that message to Signal, records the Signal message timestamp in SQLite, counts active Signal emoji reactions after the configured review window, and transfers BUGZ to the reporter wallet.

## Environment Notes

- Thirdweb wallet sessions are remembered in browser local storage and restored after refresh when the wallet still authorizes the site.
- WalletConnect QR login is handled by Thirdweb and uses `VITE_THIRDWEB_CLIENT_ID`; the committed default can be overridden per deployment.
- Do not place Pinata API keys in browser code.
- Pinata is supported only through a presigned upload endpoint.
- Without a Pinata presign endpoint, the default IPFS gateway provider can read existing IPFS JSON but cannot upload new legacy onchain dossiers.
- ENS identity lookups use Ethereum mainnet RPC and can be overridden with `VITE_ENS_RPC_URL`.
- Site-generated XMTP wallets are stored locally in the browser under `cheapbugs.localXmtpIdentity.v1`; users must keep the copied recovery key if that wallet will hold BUGZ.
- Base-specific values are isolated in [src/config/chains.ts](/home/pierce/projects/cheapbugs/src/config/chains.ts) and [src/config/env.ts](/home/pierce/projects/cheapbugs/src/config/env.ts).

## Contract Launchers

The launcher scripts are [scripts/launch-bug-index.mjs](/home/pierce/projects/cheapbugs/scripts/launch-bug-index.mjs) and [scripts/launch-token.mjs](/home/pierce/projects/cheapbugs/scripts/launch-token.mjs).

For Solidity-native deployment and testing, the repo also includes [foundry.toml](/home/pierce/projects/cheapbugs/foundry.toml), [script/LaunchBugIndex.s.sol](/home/pierce/projects/cheapbugs/script/LaunchBugIndex.s.sol), and [test/CheapBugsBugIndex.t.sol](/home/pierce/projects/cheapbugs/test/CheapBugsBugIndex.t.sol).

The bug index launcher:

- compiles [contracts/CheapBugsBugIndex.sol](/home/pierce/projects/cheapbugs/contracts/CheapBugsBugIndex.sol)
- writes `artifacts/CheapBugsBugIndex.json`
- refreshes [src/contracts/bugIndexAbi.ts](/home/pierce/projects/cheapbugs/src/contracts/bugIndexAbi.ts) so the frontend ABI stays aligned with the deployed contract
- the contract now also exposes reviewer-only `submitReviewVote` and vote query helpers so Foundry tests can cover report-rating scenarios onchain

The token launcher deploys the repo's standalone ERC20 extension contract. The live production BUGZ token is the Clanker-deployed Base token above.

The token launcher:

- compiles [contracts/CheapBugsToken.sol](/home/pierce/projects/cheapbugs/contracts/CheapBugsToken.sol)
- writes `artifacts/CheapBugsToken.json`
- refreshes [src/contracts/bugzTokenAbi.ts](/home/pierce/projects/cheapbugs/src/contracts/bugzTokenAbi.ts)
- deploys `CheapBugs Token` with symbol `BUGZ` and an initial supply of 10,000,000 tokens minted to `BUGZ_INITIAL_HOLDER` or the deployer by default

## Key Paths

- [contracts/CheapBugsBugIndex.sol](/home/pierce/projects/cheapbugs/contracts/CheapBugsBugIndex.sol)
- [contracts/CheapBugsToken.sol](/home/pierce/projects/cheapbugs/contracts/CheapBugsToken.sol)
- [scripts/launch-bug-index.mjs](/home/pierce/projects/cheapbugs/scripts/launch-bug-index.mjs)
- [scripts/launch-token.mjs](/home/pierce/projects/cheapbugs/scripts/launch-token.mjs)
- [scripts/launch-bug-index-forge.sh](/home/pierce/projects/cheapbugs/scripts/launch-bug-index-forge.sh)
- [script/LaunchBugIndex.s.sol](/home/pierce/projects/cheapbugs/script/LaunchBugIndex.s.sol)
- [test/CheapBugsBugIndex.t.sol](/home/pierce/projects/cheapbugs/test/CheapBugsBugIndex.t.sol)
- [src/contracts/bugIndex.ts](/home/pierce/projects/cheapbugs/src/contracts/bugIndex.ts)
- [src/contracts/bugzTokenAbi.ts](/home/pierce/projects/cheapbugs/src/contracts/bugzTokenAbi.ts)
- [src/auth/thirdweb.ts](/home/pierce/projects/cheapbugs/src/auth/thirdweb.ts)
- [src/auth/localIdentity.ts](/home/pierce/projects/cheapbugs/src/auth/localIdentity.ts)
- [FEATURES.md](/home/pierce/projects/cheapbugs/FEATURES.md)
- [src/xmtp/browser.ts](/home/pierce/projects/cheapbugs/src/xmtp/browser.ts)
- [src/xmtp/bouncer.ts](/home/pierce/projects/cheapbugs/src/xmtp/bouncer.ts)
- [scripts/bouncer-bot.py](/home/pierce/projects/cheapbugs/scripts/bouncer-bot.py)
- [bots/cheapbugs_bouncer/](/home/pierce/projects/cheapbugs/bots/cheapbugs_bouncer)
- [src/storage/gateway.ts](/home/pierce/projects/cheapbugs/src/storage/gateway.ts)
- [src/storage/pinata.ts](/home/pierce/projects/cheapbugs/src/storage/pinata.ts)
- [src/attest/eas.ts](/home/pierce/projects/cheapbugs/src/attest/eas.ts)
- [src/lib/reports.ts](/home/pierce/projects/cheapbugs/src/lib/reports.ts)
- [.github/workflows/deploy-pages.yml](/home/pierce/projects/cheapbugs/.github/workflows/deploy-pages.yml)

## References

- Thirdweb TypeScript SDK: https://portal.thirdweb.com/typescript/v5
- Pinata presigned uploads: https://docs.pinata.cloud/files/presigned-urls
- EAS indexing service repo: https://github.com/ethereum-attestation-service/eas-indexing-service
- IPFS web app guidance: https://docs.ipfs.tech/how-to/ipfs-in-web-apps/
