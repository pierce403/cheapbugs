import type { HexString, PayoutType } from "./domain";

export type PayoutRecord = {
  reportHash: HexString;
  payoutType: PayoutType;
  asset: HexString;
  amount: string;
  noteCid: string;
  createdAt: string;
};
