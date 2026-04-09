# Deploy

## 1. Prepare Environment

Create `.env.local` from [.env.example](/home/pierce/projects/cheapbugs/.env.example).

Frontend values:

- `VITE_THIRDWEB_CLIENT_ID`
- `VITE_BUG_INDEX_ADDRESS`
- `VITE_REVIEW_VERDICT_SCHEMA_UID`
- `VITE_PAYOUT_RECORD_SCHEMA_UID` if you want the placeholder schema pinned now
- `VITE_REVIEWER_ADDRESSES`

Launcher values:

- `BASE_RPC_URL`
- `BUG_INDEX_DEPLOYER_PRIVATE_KEY`
- `BUG_INDEX_OWNER`
- `BUG_INDEX_INITIAL_REVIEWERS`

## 2. Dry Run The Contract Build

```bash
npm run launch:bug-index:dry-run
```

This compiles the contract, writes an artifact, and refreshes the frontend ABI module.

## 3. Deploy The Bug Index Contract To Base

```bash
npm run launch:bug-index
```

The script prints the deployed contract address as:

```bash
VITE_BUG_INDEX_ADDRESS=0x...
```

Copy that value into `.env.local`.

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

The repo now includes a GitHub Actions workflow at [.github/workflows/deploy-pages.yml](/home/pierce/projects/cheapbugs/.github/workflows/deploy-pages.yml).

Required repository variable:

- `VITE_THIRDWEB_CLIENT_ID`

Recommended repository variables:

- `VITE_BUG_INDEX_ADDRESS`
- `VITE_REVIEW_VERDICT_SCHEMA_UID`
- `VITE_PAYOUT_RECORD_SCHEMA_UID`
- `VITE_REVIEWER_ADDRESSES`
- any other `VITE_*` overrides you want from [.env.example](/home/pierce/projects/cheapbugs/.env.example)

The Pages workflow builds with:

- repo-aware `VITE_BASE_PATH`
- `VITE_ROUTER_MODE=hash`
- `.nojekyll` enabled through [public/.nojekyll](/home/pierce/projects/cheapbugs/public/.nojekyll)

That combination keeps asset URLs correct under the repository subpath and avoids SPA route breakage on GitHub Pages.

### Other Static Hosts

You can still deploy `dist/` to other static hosts, for example:

- Cloudflare Pages
- Netlify
- Vercel static output

The repo already includes `public/_redirects` for Netlify-style SPA routing.

## 7. Optional IPFS Publishing

If you publish the app itself to IPFS, validate your gateway and asset-path behavior against the IPFS docs before treating it as the primary production origin.

## Operational Notes

- Public report metadata is immutable once written onchain.
- Private report details stay encrypted, but the encrypted blob CID is public because it is stored onchain.
- Review trust is currently driven by the configured reviewer allowlist.
- Pinata should only be enabled when `VITE_PINATA_PRESIGN_ENDPOINT` points to a helper that returns presigned upload URLs.
