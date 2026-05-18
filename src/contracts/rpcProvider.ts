import { JsonRpcProvider } from "ethers";

import { chainConfig } from "../config/chains";

export const createBaseReadProvider = (): JsonRpcProvider =>
  new JsonRpcProvider(chainConfig.rpcUrl, chainConfig.id, {
    batchMaxCount: 1,
    staticNetwork: true
  });
