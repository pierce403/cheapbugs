import { env } from "../config/env";
import type { StorageProvider } from "../types/storage";

import { GatewayStorageProvider } from "./gateway";
import { PinataStorageProvider } from "./pinata";

const gatewayProvider = new GatewayStorageProvider();
const pinataProvider = new PinataStorageProvider();

export const storageProviders: StorageProvider[] = [gatewayProvider, pinataProvider];

export const activeStorageProvider = (): StorageProvider => {
  if (env.storageProvider === "pinata" && pinataProvider.isConfigured()) {
    return pinataProvider;
  }

  return gatewayProvider;
};
