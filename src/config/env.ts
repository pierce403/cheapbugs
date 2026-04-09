const optionalCsv = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

export const env = {
  appName: import.meta.env.VITE_APP_NAME || "CheapBugs v2",
  thirdwebClientId: import.meta.env.VITE_THIRDWEB_CLIENT_ID || "fabb9529082a9638fe2636bac941fb29",
  chainId: Number(import.meta.env.VITE_CHAIN_ID || 8453),
  chainName: import.meta.env.VITE_CHAIN_NAME || "Base Mainnet",
  chainRpcUrl: import.meta.env.VITE_CHAIN_RPC_URL || "https://mainnet.base.org",
  ensRpcUrl: import.meta.env.VITE_ENS_RPC_URL || "https://ethereum-rpc.publicnode.com",
  nativeSymbol: import.meta.env.VITE_CHAIN_NATIVE_SYMBOL || "ETH",
  blockExplorerUrl: import.meta.env.VITE_CHAIN_BLOCK_EXPLORER_URL || "https://base.blockscout.com",
  easContractAddress:
    (import.meta.env.VITE_EAS_CONTRACT_ADDRESS as `0x${string}` | undefined) ||
    "0x4200000000000000000000000000000000000021",
  easSchemaRegistryAddress:
    (import.meta.env.VITE_EAS_SCHEMA_REGISTRY_ADDRESS as `0x${string}` | undefined) ||
    "0x4200000000000000000000000000000000000020",
  easGraphqlUrl: import.meta.env.VITE_EAS_GRAPHQL_URL || "https://base.easscan.org/graphql",
  easScanUrl: import.meta.env.VITE_EAS_SCAN_URL || "https://base.easscan.org",
  reviewVerdictSchemaUid:
    (import.meta.env.VITE_REVIEW_VERDICT_SCHEMA_UID as `0x${string}` | undefined) || "",
  payoutRecordSchemaUid:
    (import.meta.env.VITE_PAYOUT_RECORD_SCHEMA_UID as `0x${string}` | undefined) || "",
  bugIndexAddress: (import.meta.env.VITE_BUG_INDEX_ADDRESS as `0x${string}` | undefined) || "",
  routerMode: import.meta.env.VITE_ROUTER_MODE === "hash" ? "hash" : "history",
  storageProvider: import.meta.env.VITE_STORAGE_PROVIDER === "pinata" ? "pinata" : "thirdweb",
  pinataPresignEndpoint: import.meta.env.VITE_PINATA_PRESIGN_ENDPOINT || "",
  reviewerAddresses: optionalCsv(import.meta.env.VITE_REVIEWER_ADDRESSES),
  featuredReportIds: optionalCsv(import.meta.env.VITE_FEATURED_REPORT_IDS)
} as const;
