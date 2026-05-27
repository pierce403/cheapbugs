const optionalCsv = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const optionalNumber = (value: string | undefined, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const optionalBoolean = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined || value === "") {
    return fallback;
  }
  return /^(1|true|yes)$/i.test(value);
};

const defaultBugzTokenAddress = "0x60Df4a0C9A5050c337010cb29C9694cE4d8fbb07";
const defaultBugIndexAddress = "0x515FDbc9876aC26870794E26605c7DD04c18679b";
const defaultBugBondVaultAddress = "0x2Eab99B6d6F1FBDa4fa78a00662E0cf9aBd9f3d3";
const defaultBugzTreasuryAddress = "0x4A080668d9848928dc6D48921cbDc4273fe27A9d";
const defaultBugzTokenDeploymentBlock = 46093316;
const defaultBugzMarketUrl = `https://www.clanker.world/clanker/${defaultBugzTokenAddress}`;
const defaultBugzHoldersUrl = `https://basescan.org/token/${defaultBugzTokenAddress}#balances`;
const defaultBugzV4PoolHook = "0xb429d62f8f3bFFb98CdB9569533eA23bF0Ba28CC";
const defaultBugzV4PoolId = "0x4c360c12ee8063e7170c344eba74f28ab0d3879c797ed46269202c3966234657";
const defaultBugzV4PairedToken = "0x4200000000000000000000000000000000000006";
const defaultBugzV4PoolFee = 0x800000;
const defaultBugzV4TickSpacing = 200;
const defaultBaseEthUsdFeedAddress = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";
const defaultBaseEthUsdFeedUrl = "https://data.chain.link/feeds/base/mainnet/eth-usd";
const defaultBrokerXmtpAddress = "0xea6995fc3674e1e94736766f5eeefb0506e4ef32";
const configuredBugzTokenAddress =
  (import.meta.env.VITE_BUGZ_TOKEN_ADDRESS as `0x${string}` | undefined) || defaultBugzTokenAddress;
const usesDefaultBugzToken = configuredBugzTokenAddress.toLowerCase() === defaultBugzTokenAddress.toLowerCase();
const configuredBrokerXmtpAddress =
  (import.meta.env.VITE_BROKER_XMTP_ADDRESS as `0x${string}` | undefined) || defaultBrokerXmtpAddress;
const configuredBugTreasuryVaultAddress =
  (import.meta.env.VITE_BUG_TREASURY_VAULT_ADDRESS as `0x${string}` | undefined) ||
  (import.meta.env.VITE_BUGZ_TREASURY_ADDRESS as `0x${string}` | undefined) ||
  defaultBugzTreasuryAddress;

export const env = {
  appName: import.meta.env.VITE_APP_NAME || "CheapBugs",
  thirdwebClientId: import.meta.env.VITE_THIRDWEB_CLIENT_ID || "fabb9529082a9638fe2636bac941fb29",
  walletConnectProjectId: (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "").trim(),
  enableThirdwebBuyWidget: optionalBoolean(import.meta.env.VITE_ENABLE_THIRDWEB_BUY_WIDGET),
  enableThirdwebSwapWidget: optionalBoolean(import.meta.env.VITE_ENABLE_THIRDWEB_SWAP_WIDGET),
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
  bugIndexAddress: (import.meta.env.VITE_BUG_INDEX_ADDRESS as `0x${string}` | undefined) || defaultBugIndexAddress,
  bugBondVaultAddress:
    (import.meta.env.VITE_BUG_BOND_VAULT_ADDRESS as `0x${string}` | undefined) || defaultBugBondVaultAddress,
  bugTreasuryVaultAddress: configuredBugTreasuryVaultAddress,
  bugzTokenAddress: configuredBugzTokenAddress,
  bugzTreasuryAddress: configuredBugTreasuryVaultAddress,
  bugzTokenDeploymentBlock: optionalNumber(
    import.meta.env.VITE_BUGZ_TOKEN_DEPLOYMENT_BLOCK,
    usesDefaultBugzToken ? defaultBugzTokenDeploymentBlock : 0
  ),
  bugzMarketUrl: import.meta.env.VITE_BUGZ_MARKET_URL || import.meta.env.VITE_BUGZ_BUY_URL || defaultBugzMarketUrl,
  bugzHoldersUrl:
    import.meta.env.VITE_BUGZ_HOLDERS_URL ||
    (usesDefaultBugzToken ? defaultBugzHoldersUrl : `https://basescan.org/token/${configuredBugzTokenAddress}#balances`),
  etherscanApiUrl: import.meta.env.VITE_ETHERSCAN_API_URL || "https://api.etherscan.io/v2/api",
  etherscanApiKey: import.meta.env.VITE_ETHERSCAN_API_KEY || import.meta.env.VITE_BASESCAN_API_KEY || "",
  etherscanApiKeyUrl: import.meta.env.VITE_ETHERSCAN_API_KEY_URL || "https://etherscan.io/myapikey",
  etherscanTokenHolderDocsUrl:
    import.meta.env.VITE_ETHERSCAN_TOKEN_HOLDER_DOCS_URL ||
    "https://docs.etherscan.io/api-reference/endpoint/tokenholderlist",
  bugzV4PoolHook:
    (import.meta.env.VITE_BUGZ_V4_POOL_HOOK as `0x${string}` | undefined) ||
    (usesDefaultBugzToken ? defaultBugzV4PoolHook : ""),
  bugzV4PoolId:
    (import.meta.env.VITE_BUGZ_V4_POOL_ID as `0x${string}` | undefined) ||
    (usesDefaultBugzToken ? defaultBugzV4PoolId : ""),
  bugzV4PairedToken:
    (import.meta.env.VITE_BUGZ_V4_PAIRED_TOKEN as `0x${string}` | undefined) ||
    (usesDefaultBugzToken ? defaultBugzV4PairedToken : ""),
  bugzV4PoolFee: optionalNumber(
    import.meta.env.VITE_BUGZ_V4_POOL_FEE,
    usesDefaultBugzToken ? defaultBugzV4PoolFee : 0
  ),
  bugzV4TickSpacing: optionalNumber(
    import.meta.env.VITE_BUGZ_V4_TICK_SPACING,
    usesDefaultBugzToken ? defaultBugzV4TickSpacing : 0
  ),
  ethUsdFeedAddress:
    (import.meta.env.VITE_CHAINLINK_ETH_USD_FEED_ADDRESS as `0x${string}` | undefined) ||
    (Number(import.meta.env.VITE_CHAIN_ID || 8453) === 8453 ? defaultBaseEthUsdFeedAddress : ""),
  ethUsdFeedUrl: import.meta.env.VITE_CHAINLINK_ETH_USD_FEED_URL || defaultBaseEthUsdFeedUrl,
  brokerXmtpAddress: configuredBrokerXmtpAddress,
  routerMode: import.meta.env.VITE_ROUTER_MODE === "hash" ? "hash" : "history",
  storageProvider: import.meta.env.VITE_STORAGE_PROVIDER === "pinata" ? "pinata" : "ipfs-gateway",
  pinataPresignEndpoint: import.meta.env.VITE_PINATA_PRESIGN_ENDPOINT || "",
  reviewerAddresses: optionalCsv(import.meta.env.VITE_REVIEWER_ADDRESSES),
  featuredReportIds: optionalCsv(import.meta.env.VITE_FEATURED_REPORT_IDS)
} as const;
