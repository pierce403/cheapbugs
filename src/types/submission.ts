import type { DisclosureMode, HexString, TargetKind } from "./domain";

export type SubmissionPublic = {
  reportId: string;
  reportHash: HexString;
  reporterAddress: HexString;
  createdAt: string;
  disclosureMode: DisclosureMode;
  publicSummary: string;
  encryptedPayloadCid: string;
  targetKind: TargetKind;
  targetRefHash: HexString;
  tags: string[];
  contentHash: HexString;
};

export type SubmissionPrivate = {
  title: string;
  details: string;
  reproSteps: string;
  evidence: string;
  suggestedSeverity: string;
  contactHints: string;
  targetRef: string;
};

export type SubmissionBundle = {
  publicSubmission: SubmissionPublic;
};
