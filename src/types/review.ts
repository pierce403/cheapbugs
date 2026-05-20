import type { HexString, Impact, RewardClass, Validity } from "./domain";

export type ReviewVerdict = {
  reportHash: HexString;
  reviewer: HexString;
  validity: Validity;
  impact: Impact;
  rewardClass: RewardClass;
  confidence: number;
  noteCid: string;
  createdAt: string;
};

export type ReviewNote = {
  note: string;
  createdAt: string;
};

export type ReviewDisplayState = {
  headline: ReviewVerdict | null;
  latest: ReviewVerdict[];
  trusted: ReviewVerdict[];
  ignored: ReviewVerdict[];
  confidenceAverage: number | null;
};
