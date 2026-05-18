import type { DisclosureMode, HexString, TargetKind } from "./domain";

export const BUG_TYPE_OPTIONS = [
  {
    value: "0day",
    label: "0day : for new appsec bugs"
  },
  {
    value: "nday",
    label: "nday : improved exploits for existing bugs"
  },
  {
    value: "web",
    label: "web : bug in some webapp somewhere in the world"
  },
  {
    value: "net",
    label: "net : bug in some network service somewhere in the world"
  },
  {
    value: "intel",
    label: "intel : infosec relevant threat intelligence"
  }
] as const;

export type BugType = (typeof BUG_TYPE_OPTIONS)[number]["value"];

export const SUBMISSION_RATING_VALUES = ["low", "medium", "high", "critical"] as const;
export type SubmissionRating = (typeof SUBMISSION_RATING_VALUES)[number];

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
  bugType: BugType;
  title: string;
  details: string;
  reproSteps: string;
  evidence: string;
  severity: SubmissionRating;
  targetInterest: SubmissionRating;
  contactHints: string;
  targetRef: string;
};

export type SubmissionBundle = {
  publicSubmission: SubmissionPublic;
};
