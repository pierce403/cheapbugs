export const DISCLOSURE_MODES = ["private", "embargoed", "public"] as const;
export const VALIDITY_VALUES = ["confirmed", "unconfirmed", "invalid", "duplicate", "spam"] as const;
export const IMPACT_VALUES = ["none", "low", "medium", "high", "critical"] as const;
export const REWARD_CLASS_VALUES = ["none", "points", "paid"] as const;
export const TARGET_KINDS = ["repo", "package", "domain", "contract", "protocol", "other"] as const;
export const PAYOUT_TYPES = ["none", "stablecoin", "native", "points", "other"] as const;
export const BUG_INDEX_STATUS_VALUES = ["unreviewed", "valid", "invalid", "spam"] as const;

export type DisclosureMode = (typeof DISCLOSURE_MODES)[number];
export type Validity = (typeof VALIDITY_VALUES)[number];
export type Impact = (typeof IMPACT_VALUES)[number];
export type RewardClass = (typeof REWARD_CLASS_VALUES)[number];
export type TargetKind = (typeof TARGET_KINDS)[number];
export type PayoutType = (typeof PAYOUT_TYPES)[number];
export type BugIndexStatus = (typeof BUG_INDEX_STATUS_VALUES)[number];

export type HexString = `0x${string}`;

export type SchemaRef = {
  name: "ReviewVerdict" | "PayoutRecord";
  uid: HexString | "";
  definition: string;
  resolverAddress: HexString;
  revocable: boolean;
};

export type AppNotice = {
  id: string;
  tone: "info" | "warning" | "error" | "success";
  message: string;
};
