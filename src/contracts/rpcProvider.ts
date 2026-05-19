import { FetchRequest, JsonRpcProvider } from "ethers";

import { chainConfig } from "../config/chains";

const READ_RPC_TIMEOUT_MS = 8_000;

const createBaseReadRequest = (): FetchRequest => {
  const request = new FetchRequest(chainConfig.rpcUrl);
  request.timeout = READ_RPC_TIMEOUT_MS;
  request.retryFunc = async () => false;
  return request;
};

export const createBaseReadProvider = (): JsonRpcProvider =>
  new JsonRpcProvider(createBaseReadRequest(), chainConfig.id, {
    batchMaxCount: 1,
    staticNetwork: true
  });
