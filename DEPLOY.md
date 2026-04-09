# Deploy

## 1. Prepare Environment

Create `.env.local` from [.env.example](/home/pierce/projects/cheapbugs/.env.example).

Frontend values:

- `VITE_BUG_INDEX_ADDRESS`
- `VITE_BUGZ_TOKEN_ADDRESS` only if and when token-aware frontend features are added
- `VITE_BUGZ_TREASURY_ADDRESS` when the token manager should report treasury size
- `VITE_BUGZ_TOKEN_DEPLOYMENT_BLOCK` when the patrons leaderboard should reconstruct holder balances from Transfer logs
- `VITE_BUGZ_BUY_URL` when the token manager should hand off to an external buy flow
- `VITE_REVIEW_VERDICT_SCHEMA_UID`
- `VITE_PAYOUT_RECORD_SCHEMA_UID` if you want the placeholder schema pinned now
- `VITE_REVIEWER_ADDRESSES`
- `VITE_ENS_RPC_URL` only if you want to override the default Ethereum mainnet ENS RPC endpoint

`VITE_THIRDWEB_CLIENT_ID` already defaults to the current public client ID and only needs to be set if you want to override it.

Launcher values:

- `BASE_RPC_URL`
- `BUG_INDEX_DEPLOYER_PRIVATE_KEY`
- `BUG_INDEX_OWNER`
- `BUG_INDEX_INITIAL_REVIEWERS`
- `BUGZ_DEPLOYER_PRIVATE_KEY` for token deployment
- `BUGZ_INITIAL_HOLDER` if the 10,000,000 BUGZ supply should mint somewhere other than the deployer

## 2. Dry Run The Contract Build

```bash
npm run launch:bug-index:dry-run
npm run launch:bug-index:forge:dry-run
npm run launch:token:dry-run
```

This compiles the contracts, writes artifacts, refreshes the frontend ABI modules, and lets you simulate the Foundry deployment path without broadcasting.

## 3. Deploy The Bug Index Contract To Base

```bash
npm run launch:bug-index
```

Foundry-based launch:

```bash
npm run launch:bug-index:forge
```

The Forge launcher uses [script/LaunchBugIndex.s.sol](/home/pierce/projects/cheapbugs/script/LaunchBugIndex.s.sol) through [scripts/launch-bug-index-forge.sh](/home/pierce/projects/cheapbugs/scripts/launch-bug-index-forge.sh) and reads the same `BUG_INDEX_*` environment values.

The script prints the deployed contract address as:

```bash
VITE_BUG_INDEX_ADDRESS=0x...
```

Copy that value into `.env.local`.

## 4. Optional Deploy The BUGZ Token To Base

```bash
npm run launch:token
```

The launcher deploys `CheapBugs Token` with symbol `BUGZ` and mints 10,000,000 tokens to `BUGZ_INITIAL_HOLDER` or the deployer if no holder override is set.

It prints the deployed contract address as:

```bash
VITE_BUGZ_TOKEN_ADDRESS=0x...
```

Only copy that into `.env.local` when the frontend actually needs to reference the token.

## 5. Register EAS Schemas On Base

Required now:

- `ReviewVerdict`

Optional placeholder now:

- `PayoutRecord`

You can register from the reviewer UI, but for a real deployment you should pin the returned schema UIDs in `.env.local` so every client reads and writes the same schema IDs.

## 6. Build Static Assets

```bash
npm run build
```

The site outputs to `dist/`.

## 7. Publish Static Assets

### GitHub Pages

The repo now includes a GitHub Actions workflow at [.github/workflows/deploy-pages.yml](/home/pierce/projects/cheapbugs/.github/workflows/deploy-pages.yml).
In GitHub repository settings, Pages should be configured to deploy from `GitHub Actions`, not from a branch.

Recommended repository variables:

- `VITE_BUG_INDEX_ADDRESS`
- `VITE_REVIEW_VERDICT_SCHEMA_UID`
- `VITE_PAYOUT_RECORD_SCHEMA_UID`
- `VITE_REVIEWER_ADDRESSES`
- any other `VITE_*` overrides you want from [.env.example](/home/pierce/projects/cheapbugs/.env.example)

The Pages workflow builds with:

- `VITE_BASE_PATH=/` for the `cheapbugs.net` custom domain
- `VITE_ROUTER_MODE=hash`
- `.nojekyll` enabled through [public/.nojekyll](/home/pierce/projects/cheapbugs/public/.nojekyll)

That combination keeps asset URLs correct at the domain root and avoids SPA route breakage on GitHub Pages.
The build uses the committed public thirdweb client ID by default, with `VITE_THIRDWEB_CLIENT_ID` available as an override.

If you ever deploy the same app under a repository subpath instead of the custom domain, override `VITE_BASE_PATH` for that environment explicitly.

### Other Static Hosts

You can still deploy `dist/` to other static hosts, for example:

- Cloudflare Pages
- Netlify
- Vercel static output

The repo already includes `public/_redirects` for Netlify-style SPA routing.

## 8. Optional IPFS Publishing

If you publish the app itself to IPFS, validate your gateway and asset-path behavior against the IPFS docs before treating it as the primary production origin.

## Operational Notes

- Public report metadata is immutable once written onchain.
- Private report details stay encrypted, but the encrypted blob CID is public because it is stored onchain.
- Review trust is currently driven by the configured reviewer allowlist.
- The bug index contract now also supports reviewer-only onchain vote records for contract-level testing and future extensions, but the current frontend still computes live review state from EAS.
- The token manager and patrons leaderboard are safe to deploy before BUGZ exists, but they only become live once the relevant `VITE_BUGZ_*` values are configured.
- Pinata should only be enabled when `VITE_PINATA_PRESIGN_ENDPOINT` points to a helper that returns presigned upload URLs.
- The BUGZ token contract is not part of the current app runtime and exists as an extension point for later token features.
