# Deploy

## 1. Prepare Environment

Create `.env.local` from [.env.example](.env.example).

Frontend values:

- `VITE_BUG_INDEX_ADDRESS`
- `VITE_BUGZ_TOKEN_ADDRESS` only if token-aware frontend features should override the live Base BUGZ default
- `VITE_BUGZ_TREASURY_ADDRESS` only when overriding the committed Base treasury vault used for token-manager treasury stats
- `VITE_ETHERSCAN_API_KEY` or `VITE_BASESCAN_API_KEY` when the patrons leaderboard should use the Etherscan V2 holder API for Base. Generate it from the Etherscan API Dashboard at `https://etherscan.io/myapikey`; Etherscan documents `tokenholderlist` as a paid holder endpoint.
- `VITE_BUGZ_TOKEN_DEPLOYMENT_BLOCK` when the patrons leaderboard should fall back to reconstructing holder balances from Transfer logs
- `VITE_BUGZ_HOLDERS_URL` when overriding the default BaseScan holder-distribution link
- `VITE_BUGZ_BUY_URL` when the token manager should hand off to an external buy flow
- `VITE_REVIEW_VERDICT_SCHEMA_UID`
- `VITE_PAYOUT_RECORD_SCHEMA_UID` if you want the placeholder schema pinned now
- `VITE_REVIEWER_ADDRESSES`
- `VITE_THIRDWEB_CLIENT_ID` only if you want to override the committed public Thirdweb client id used for wallet login and WalletConnect QR
- `VITE_ENS_RPC_URL` only if you want to override the default Ethereum mainnet ENS RPC endpoint

Launcher values:

- `BASE_RPC_URL`
- `BUG_INDEX_DEPLOYER_PRIVATE_KEY`, or omit it to deploy from `BROKER_KEY`
- `BUG_INDEX_OWNER`, defaulting to `0x7ab874Eeef0169ADA0d225E9801A3FfFfa26aAC3`
- `BUG_INDEX_INITIAL_BROKERS`
- `BUG_INDEX_INITIAL_ADMINS`
- `BUG_INDEX_INITIAL_SLASHERS`
- `ETHERSCAN_API_KEY` or `BASESCAN_API_KEY` for contract verification
- `ETHERSCAN_API_VERSION` only when your Foundry/Etherscan setup requires an explicit API version
- `BUG_INDEX_VERIFY_CONTRACTS=0` only when intentionally deploying without explorer verification

## 2. Dry Run The Contract Build

```bash
npm run launch:bug-index:dry-run
npm run launch:bug-index:forge:dry-run
```

This compiles the contracts, writes artifacts, refreshes the frontend ABI modules, and lets you simulate the Foundry deployment path without broadcasting.

The Node dry run also writes the tracked reproducibility manifest at `deployments/base-8453/cheapbugs-contract-suite.latest.json` and full generated contract artifacts under `deployments/base-8453/generated/latest/`.

## 3. Deploy The CheapBugs Contract Suite To Base

```bash
npm run launch:bug-index
```

Foundry-based launch:

```bash
npm run launch:bug-index:forge
```

The Forge launcher uses [script/LaunchBugIndex.s.sol](script/LaunchBugIndex.s.sol) through [scripts/launch-bug-index-forge.sh](scripts/launch-bug-index-forge.sh) and reads the same `BUG_INDEX_*` environment values.

The script deploys and wires `CheapBugsTreasuryVault`, `CheapBugsBondVault`, and `CheapBugsBugIndex`. Vaults hardcode the live Base BUGZ token address.

If `BUG_INDEX_DEPLOYER_PRIVATE_KEY` is unset, the launchers use `BROKER_KEY` as the deployer. In that fallback mode, the broker wallet is also added as the initial index/treasury broker when `BUG_INDEX_INITIAL_BROKERS` is empty. Ownership is then transferred to `BUG_INDEX_OWNER`.

Real deployments verify all three contracts on Etherscan/BaseScan by default after post-deploy wiring checks pass. The script fails before broadcasting if `ETHERSCAN_API_KEY` or `BASESCAN_API_KEY` is missing, unless `BUG_INDEX_VERIFY_CONTRACTS=0` is set.

The Node launcher records a detailed deploy log for every successful real deployment. It updates `deployments/base-8453/cheapbugs-contract-suite.latest.json`, writes an address-specific manifest named `deployments/base-8453/cheapbugs-contract-suite.<index-address>.json`, and commits-ready generated artifacts under `deployments/base-8453/generated/<index-address>/`. The manifest includes compiler versions, optimizer settings, `via_ir`, source/package hashes, constructor arguments, transaction hashes, gas data, explorer verification command inputs, and the paths/hashes for all generated contract artifacts. It intentionally omits private keys, explorer API keys, and full RPC URLs.

The script prints the deployed index address as:

```bash
VITE_BUG_INDEX_ADDRESS=0x515FDbc9876aC26870794E26605c7DD04c18679b
```

The current Base deployment is:

- `CheapBugsBugIndex`: `0x515FDbc9876aC26870794E26605c7DD04c18679b`
- `CheapBugsBondVault`: `0x2Eab99B6d6F1FBDa4fa78a00662E0cf9aBd9f3d3`
- `CheapBugsTreasuryVault`: `0x4A080668d9848928dc6D48921cbDc4273fe27A9d`

Those values are committed as the default frontend contract addresses. Override them in `.env.local` only for alternate deployments.

## 4. Register EAS Schemas On Base

Required now:

- `ReviewVerdict`

Optional placeholder now:

- `PayoutRecord`

You can register from the reviewer UI, but for a real deployment you should pin the returned schema UIDs in `.env.local` so every client reads and writes the same schema IDs.

## 5. Build Static Assets

```bash
npm run build
```

The site outputs to `dist/`.

## 6. Publish Static Assets

### GitHub Pages

The repo now includes a GitHub Actions workflow at [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml).
In GitHub repository settings, Pages should be configured to deploy from `GitHub Actions`, not from a branch.

Recommended repository variables:

- `VITE_BUG_INDEX_ADDRESS`
- `VITE_REVIEW_VERDICT_SCHEMA_UID`
- `VITE_PAYOUT_RECORD_SCHEMA_UID`
- `VITE_REVIEWER_ADDRESSES`
- any other `VITE_*` overrides you want from [.env.example](.env.example)

The Pages workflow builds with:

- `VITE_BASE_PATH=/` for the `cheapbugs.net` custom domain
- `VITE_ROUTER_MODE=hash`
- `.nojekyll` enabled through [public/.nojekyll](public/.nojekyll)

That combination keeps asset URLs correct at the domain root and avoids SPA route breakage on GitHub Pages.
Set `VITE_THIRDWEB_CLIENT_ID` as a repository variable only if the hosted site should use a different Thirdweb client id.

If you ever deploy the same app under a repository subpath instead of the custom domain, override `VITE_BASE_PATH` for that environment explicitly.

### Other Static Hosts

You can still deploy `dist/` to other static hosts, for example:

- Cloudflare Pages
- Netlify
- Vercel static output

The repo already includes `public/_redirects` for Netlify-style SPA routing.

## 7. Optional IPFS Publishing

If you publish the app itself to IPFS, validate your gateway and asset-path behavior against the IPFS docs before treating it as the primary production origin.

## Operational Notes

- The smart contracts cover the planned onchain mechanics for bonding, slashing, detail-key payment records, broker-published reports, bonded voting, details-key reveal, and ordered treasury payouts. The broker now submits accepted XMTP/IPFS submissions to `CheapBugsBugIndex.publishBug` when `BROKER_DRY_RUN=0`; the full production system still needs live XMTP smoke tests and finalized operational key/funding procedures.
- Deployment manifests under `deployments/` are intentionally tracked reproducibility records. `artifacts/`, `out/`, `cache/`, and `broadcast/` remain transient Foundry/launcher output unless a future task explicitly says otherwise.
- Public report metadata is immutable once written onchain.
- Private report details stay encrypted, but the encrypted blob CID is public because it is stored onchain.
- Review trust is currently driven by the configured reviewer allowlist.
- The bug index contract supports bonded onchain vote records for contract-level testing and future extensions, but the current frontend still computes live review state from EAS.
- The token manager and patrons leaderboard use the live Base BUGZ token by default and only need `VITE_BUGZ_*` overrides for alternate deployments or optional display rows. The patrons board prefers the Etherscan V2 holder API and falls back to Transfer-log reconstruction from `VITE_BUGZ_TOKEN_DEPLOYMENT_BLOCK`.
- Pinata should only be enabled when `VITE_PINATA_PRESIGN_ENDPOINT` points to a helper that returns presigned upload URLs.
- This repo no longer deploys a BUGZ token contract; the vaults hardcode the live Base BUGZ address.
