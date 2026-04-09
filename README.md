# CheapBugs

CheapBugs is a static Vite + TypeScript app for Base-native bug intake and review.

The current MVP stores public-safe report records onchain in `CheapBugsBugIndex` on Base, keeps the private dossier encrypted client-side before uploading it to IPFS, and uses EAS on Base for reviewer verdict attestations and payout-record placeholders.

The repo also includes a standalone `BUGZ` ERC20 contract and Base launcher as a clean extension point for future token-gated or reward features, but the live app does not depend on that token yet.

The frontend now reserves first-class routes for `index`, `submit`, `review`, `token`, and `patrons`. The token and patrons screens are safe to ship before BUGZ is deployed and fall back to placeholder mode until token config is present.

For contract development, the repo now also includes a Foundry workspace with a deploy script and scenario tests for bug submission and reviewer vote flows.

## What Is In Scope

- thirdweb login with email verification code flow and in-app wallet
- external wallet connect for advanced users
- Base-only onchain report index contract
- encrypted private report uploads to IPFS
- EAS review verdict attestations
- public browsing, report pages, and reviewer queue
- static deployment with no backend database

## What Is Not In Scope Yet

- token sale
- treasury logic
- Compound integration
- DAO governance
- payout execution

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
- optional `VITE_BUGZ_TOKEN_ADDRESS`, `VITE_BUGZ_TREASURY_ADDRESS`, `VITE_BUGZ_TOKEN_DEPLOYMENT_BLOCK`, and `VITE_BUGZ_BUY_URL` when the token dashboard should go live
- `VITE_REVIEW_VERDICT_SCHEMA_UID` after registering the EAS schema
- `VITE_REVIEWER_ADDRESSES` for trusted reviewers

`VITE_THIRDWEB_CLIENT_ID` already defaults to the current public thirdweb client ID in source and can be overridden if needed.

4. Dry-run the contract launcher:

```bash
npm run launch:bug-index:dry-run
npm run launch:token:dry-run
npm run launch:bug-index:forge:dry-run
npm run contracts:test
```

5. Deploy the Base bug index contract when ready:

```bash
npm run launch:bug-index
```

Optional future-token deployment:

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
The build defaults to the current public thirdweb client ID and can still be overridden with `VITE_THIRDWEB_CLIENT_ID`.

## How Reports Work

1. A reporter signs in with thirdweb using either email verification or an external wallet.
2. The browser builds `SubmissionPrivate` and `SubmissionPublic`.
3. `SubmissionPrivate` is encrypted locally in the browser.
4. The encrypted private dossier is uploaded to IPFS through the configured storage provider.
5. The public-safe report record is written onchain to `CheapBugsBugIndex` on Base.
6. Reviewers publish verdicts as EAS onchain attestations on Base.
7. The frontend reads the bug index contract for reports and the EAS GraphQL API for verdicts.

## Environment Notes

- The browser initializes thirdweb with `clientId` only.
- Do not place any thirdweb `secretKey` in client code.
- Do not place Pinata API keys in browser code.
- Pinata is supported only through a presigned upload endpoint.
- ENS identity lookups use Ethereum mainnet RPC and can be overridden with `VITE_ENS_RPC_URL`.
- Base-specific values are isolated in [src/config/chains.ts](/home/pierce/projects/cheapbugs/src/config/chains.ts) and [src/config/env.ts](/home/pierce/projects/cheapbugs/src/config/env.ts).

## Contract Launchers

The launcher scripts are [scripts/launch-bug-index.mjs](/home/pierce/projects/cheapbugs/scripts/launch-bug-index.mjs) and [scripts/launch-token.mjs](/home/pierce/projects/cheapbugs/scripts/launch-token.mjs).

For Solidity-native deployment and testing, the repo also includes [foundry.toml](/home/pierce/projects/cheapbugs/foundry.toml), [script/LaunchBugIndex.s.sol](/home/pierce/projects/cheapbugs/script/LaunchBugIndex.s.sol), and [test/CheapBugsBugIndex.t.sol](/home/pierce/projects/cheapbugs/test/CheapBugsBugIndex.t.sol).

The bug index launcher:

- compiles [contracts/CheapBugsBugIndex.sol](/home/pierce/projects/cheapbugs/contracts/CheapBugsBugIndex.sol)
- writes `artifacts/CheapBugsBugIndex.json`
- refreshes [src/contracts/bugIndexAbi.ts](/home/pierce/projects/cheapbugs/src/contracts/bugIndexAbi.ts) so the frontend ABI stays aligned with the deployed contract
- the contract now also exposes reviewer-only `submitReviewVote` and vote query helpers so Foundry tests can cover report-rating scenarios onchain

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
- [src/storage/thirdweb.ts](/home/pierce/projects/cheapbugs/src/storage/thirdweb.ts)
- [src/storage/pinata.ts](/home/pierce/projects/cheapbugs/src/storage/pinata.ts)
- [src/attest/eas.ts](/home/pierce/projects/cheapbugs/src/attest/eas.ts)
- [src/lib/reports.ts](/home/pierce/projects/cheapbugs/src/lib/reports.ts)
- [.github/workflows/deploy-pages.yml](/home/pierce/projects/cheapbugs/.github/workflows/deploy-pages.yml)

## References

- thirdweb TypeScript client: https://portal.thirdweb.com/typescript/v5/client
- thirdweb in-app wallets: https://portal.thirdweb.com/typescript/v5/in-app-wallet/get-started
- thirdweb storage: https://portal.thirdweb.com/references/typescript/v4/download
- Pinata presigned uploads: https://docs.pinata.cloud/files/presigned-urls
- EAS indexing service repo: https://github.com/ethereum-attestation-service/eas-indexing-service
- IPFS web app guidance: https://docs.ipfs.tech/how-to/ipfs-in-web-apps/
