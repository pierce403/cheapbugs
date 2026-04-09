import type { HexString, SchemaRef } from "../types/domain";
import { env } from "../config/env";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as HexString;
export const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as HexString;

export const APP_METADATA = {
  name: env.appName,
  url: typeof window === "undefined" ? "http://localhost" : window.location.origin,
  description: "Static Base-native bug report archive with onchain indexing, encrypted IPFS dossiers, and EAS verdicts.",
  logoUrl: typeof window === "undefined" ? "" : `${window.location.origin}/favicon.ico`
} as const;

export const STORAGE_KEYS = {
  reportAccess: "cheapbugs.report-access",
  cachePrefix: "cheapbugs.cache",
  flashMessage: "cheapbugs.flash",
  lastUsedStorage: "cheapbugs.storage"
} as const;

export const EAS_SCHEMAS: Record<SchemaRef["name"], SchemaRef> = {
  ReviewVerdict: {
    name: "ReviewVerdict",
    uid: env.reviewVerdictSchemaUid,
    definition: "bytes32 reportHash,uint8 validity,uint8 impact,uint8 rewardClass,uint8 confidence,string noteCID",
    resolverAddress: ZERO_ADDRESS,
    revocable: true
  },
  PayoutRecord: {
    name: "PayoutRecord",
    uid: env.payoutRecordSchemaUid,
    definition: "bytes32 reportHash,uint8 payoutType,address asset,uint256 amount,string noteCID",
    resolverAddress: ZERO_ADDRESS,
    revocable: true
  }
};
