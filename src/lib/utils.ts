import { formatUnits } from "ethers";
import { keccak256, toBytes } from "viem";

import {
  DISCLOSURE_MODES,
  IMPACT_VALUES,
  PAYOUT_TYPES,
  REWARD_CLASS_VALUES,
  TARGET_KINDS,
  VALIDITY_VALUES
} from "../types/domain";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const normalizeAddress = (value: string): `0x${string}` => value.toLowerCase() as `0x${string}`;

export const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (isObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        const nested = value[key];
        if (nested !== undefined) {
          accumulator[key] = canonicalize(nested);
        }

        return accumulator;
      }, {});
  }

  return value;
};

export const stableStringify = (value: unknown): string => JSON.stringify(canonicalize(value));

export const hashText = (value: string): `0x${string}` => keccak256(toBytes(value.trim()));

export const hashJson = (value: unknown): `0x${string}` => keccak256(toBytes(stableStringify(value)));

export const toReportId = (reportHash: `0x${string}`): string => `cb-${reportHash.slice(2, 10)}`;

export const shortHash = (value: string, head = 10, tail = 6): string =>
  value.length <= head + tail ? value : `${value.slice(0, head)}...${value.slice(-tail)}`;

export const timestampToIso = (value: number): string => new Date(value * 1000).toISOString();

export const formatDate = (isoDate: string): string =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(isoDate));

export const formatNumber = (value: number): string =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

export const formatTokenAmount = (value: bigint, decimals = 18, maxFractionDigits = 4): string => {
  const [wholeRaw, fractionalRaw = ""] = formatUnits(value, decimals).split(".");
  const whole = new Intl.NumberFormat("en-US").format(BigInt(wholeRaw || "0"));
  const fractional = fractionalRaw.slice(0, maxFractionDigits).replace(/0+$/, "");
  return fractional ? `${whole}.${fractional}` : whole;
};

export const parseTags = (raw: string): string[] =>
  raw
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 10);

export const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const newlineToBreaks = (value: string): string => escapeHtml(value).replaceAll("\n", "<br />");

export const textOrDash = (value: string | null | undefined): string => (value && value.trim() ? value : "-");

export const disclosureModeToIndex = (mode: (typeof DISCLOSURE_MODES)[number]): number =>
  DISCLOSURE_MODES.indexOf(mode);

export const validityToIndex = (value: (typeof VALIDITY_VALUES)[number]): number =>
  VALIDITY_VALUES.indexOf(value);

export const impactToIndex = (value: (typeof IMPACT_VALUES)[number]): number => IMPACT_VALUES.indexOf(value);

export const rewardClassToIndex = (value: (typeof REWARD_CLASS_VALUES)[number]): number =>
  REWARD_CLASS_VALUES.indexOf(value);

export const payoutTypeToIndex = (value: (typeof PAYOUT_TYPES)[number]): number => PAYOUT_TYPES.indexOf(value);
export const targetKindToIndex = (value: (typeof TARGET_KINDS)[number]): number => TARGET_KINDS.indexOf(value);

export const indexToDisclosureMode = (index: number) => DISCLOSURE_MODES[index] ?? DISCLOSURE_MODES[0];
export const indexToValidity = (index: number) => VALIDITY_VALUES[index] ?? VALIDITY_VALUES[1];
export const indexToImpact = (index: number) => IMPACT_VALUES[index] ?? IMPACT_VALUES[0];
export const indexToRewardClass = (index: number) => REWARD_CLASS_VALUES[index] ?? REWARD_CLASS_VALUES[0];
export const indexToPayoutType = (index: number) => PAYOUT_TYPES[index] ?? PAYOUT_TYPES[0];
export const indexToTargetKind = (index: number) => TARGET_KINDS[index] ?? TARGET_KINDS[TARGET_KINDS.length - 1];
export const isTargetKind = (value: string): value is (typeof TARGET_KINDS)[number] =>
  TARGET_KINDS.includes(value as (typeof TARGET_KINDS)[number]);

export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const uidToScanUrl = (base: string, uid: string): string => `${base}/attestation/view/${uid}`;

export const txToExplorerUrl = (base: string, txHash: string): string => `${base}/tx/${txHash}`;
