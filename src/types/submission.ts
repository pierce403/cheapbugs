import type { BugIndexStatus, DisclosureMode, HexString, TargetKind } from "./domain";

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
    value: "web3",
    label: "web3 : bug in smart contracts, wallets, dapps, or onchain protocols"
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

export const SUBMISSION_TEXT_LIMITS = {
  title: { label: "Title", min: 3, max: 120 },
  targetRef: { label: "Target", min: 2, max: 160 },
  publicSummary: { label: "Public summary", min: 10, max: 2_000 },
  details: { label: "Private details", min: 10, max: 12_000 }
} as const;

export type SubmissionTextField = keyof typeof SUBMISSION_TEXT_LIMITS;

export type SubmissionTextValidationIssue = {
  field: SubmissionTextField;
  message: string;
};

export type SubmissionTextValues = Record<SubmissionTextField, string>;

export const validateSubmissionTextFields = (input: SubmissionTextValues): SubmissionTextValidationIssue | null => {
  for (const field of Object.keys(SUBMISSION_TEXT_LIMITS) as SubmissionTextField[]) {
    const limit = SUBMISSION_TEXT_LIMITS[field];
    const length = input[field].trim().length;
    if (length < limit.min) {
      return {
        field,
        message: `${limit.label} must be at least ${limit.min.toLocaleString("en-US")} characters after trimming.`
      };
    }
    if (length > limit.max) {
      return {
        field,
        message: `${limit.label} must be at most ${limit.max.toLocaleString("en-US")} characters after trimming.`
      };
    }
  }
  return null;
};

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
  bugBundleHash: HexString;
  encryptedDetailsHash: HexString;
  detailsKeyCommitment: HexString;
  revealAfter: string | null;
  detailsKeyRevealed: boolean;
  indexStatus?: BugIndexStatus;
  payoutCompleted?: boolean;
};

export type SubmissionPublicMetadata = {
  title: string | null;
  targetKind: TargetKind | null;
  targetReference: string | null;
  errorMessage: string | null;
  status: "ready" | "loading" | "unavailable";
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
  publicMetadata: SubmissionPublicMetadata;
};
