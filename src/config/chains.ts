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
  bugIndexAddress: env.bugIndexAddress
} as const;
