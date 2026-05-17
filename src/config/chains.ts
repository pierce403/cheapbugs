import { env } from "./env";

export const chainConfig = {
  id: env.chainId,
  name: env.chainName,
  rpcUrl: env.chainRpcUrl,
  nativeSymbol: env.nativeSymbol,
  explorerUrl: env.blockExplorerUrl,
  easContractAddress: env.easContractAddress,
  easSchemaRegistryAddress: env.easSchemaRegistryAddress,
  easGraphqlUrl: env.easGraphqlUrl,
  easScanUrl: env.easScanUrl,
  bugIndexAddress: env.bugIndexAddress,
  bugzTokenAddress: env.bugzTokenAddress,
  bugzTreasuryAddress: env.bugzTreasuryAddress,
  bugzTokenDeploymentBlock: env.bugzTokenDeploymentBlock,
  bugzMarketUrl: env.bugzMarketUrl,
  bugzV4PoolHook: env.bugzV4PoolHook,
  bugzV4PoolId: env.bugzV4PoolId,
  bugzV4PairedToken: env.bugzV4PairedToken,
  bugzV4PoolFee: env.bugzV4PoolFee,
  bugzV4TickSpacing: env.bugzV4TickSpacing
} as const;
