import { defineChain } from "thirdweb/chains";

import { env } from "./env";

export const appChain = defineChain({
  id: env.chainId,
  name: env.chainName,
  nativeCurrency: {
    decimals: 18,
    name: env.nativeSymbol,
    symbol: env.nativeSymbol
  },
  rpc: env.chainRpcUrl,
  blockExplorers: [
    {
      name: `${env.chainName} Explorer`,
      url: env.blockExplorerUrl
    }
  ]
});

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
  bugBondVaultAddress: env.bugBondVaultAddress,
  bugTreasuryVaultAddress: env.bugTreasuryVaultAddress,
  bugzTokenAddress: env.bugzTokenAddress,
  bugzTreasuryAddress: env.bugzTreasuryAddress,
  bugzTokenDeploymentBlock: env.bugzTokenDeploymentBlock,
  bugzMarketUrl: env.bugzMarketUrl,
  bugzHoldersUrl: env.bugzHoldersUrl,
  etherscanApiUrl: env.etherscanApiUrl,
  etherscanApiKey: env.etherscanApiKey,
  etherscanApiKeyUrl: env.etherscanApiKeyUrl,
  etherscanTokenHolderDocsUrl: env.etherscanTokenHolderDocsUrl,
  bugzV4PoolHook: env.bugzV4PoolHook,
  bugzV4PoolId: env.bugzV4PoolId,
  bugzV4PairedToken: env.bugzV4PairedToken,
  bugzV4PoolFee: env.bugzV4PoolFee,
  bugzV4TickSpacing: env.bugzV4TickSpacing
} as const;
