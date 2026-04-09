import { env } from "../config/env";
import type { StorageProvider } from "../types/storage";

import { PinataStorageProvider } from "./pinata";
import { ThirdwebStorageProvider } from "./thirdweb";

const thirdwebProvider = new ThirdwebStorageProvider();
const pinataProvider = new PinataStorageProvider();

export const storageProviders: StorageProvider[] = [thirdwebProvider, pinataProvider];

export const activeStorageProvider = (): StorageProvider => {
  if (env.storageProvider === "pinata" && pinataProvider.isConfigured()) {
    return pinataProvider;
  }

  return thirdwebProvider;
};
