import type { ReviewVerdict } from "../types/review";
import type {
  BugType,
  SubmissionBundle,
  SubmissionPrivate,
  SubmissionPublic,
  SubmissionPublicMetadata,
  SubmissionRating
} from "../types/submission";
import type { DisclosureMode, Impact, RewardClass, TargetKind, Validity } from "../types/domain";

import { createReviewVerdictAttestation } from "../attest/eas";
import { getBugReport, getLatestBugReports } from "../contracts/bugIndex";
import { activeStorageProvider } from "../storage";
import { decryptJson, type EncryptedEnvelope } from "./crypto";
import { computeReviewDisplayState, getReviewVerdictsByReportHash } from "./eas";
import { downloadJson, uploadJson } from "./ipfs";
import { getReportAccessKey } from "./report-access";
import { isTargetKind } from "./utils";

export type SubmissionFormInput = {
  bugType: BugType;
  title: string;
  publicSummary: string;
  details: string;
  reproSteps: string;
  evidence: string;
  severity: SubmissionRating;
  targetInterest: SubmissionRating;
  contactHints: string;
  targetKind: TargetKind;
  targetRef: string;
  tags: string;
  disclosureMode: DisclosureMode;
};

export type ReviewFormInput = {
  validity: Validity;
  impact: Impact;
  rewardClass: RewardClass;
  confidence: number;
  note: string;
};

const MAX_PUBLIC_BUNDLE_TITLE_LENGTH = 200;
const MAX_PUBLIC_BUNDLE_TARGET_LENGTH = 240;
const PUBLIC_BUNDLE_METADATA_TIMEOUT_MS = 2_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const trimmedString = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
};

const emptyPublicMetadata = (errorMessage: string | null = null): SubmissionPublicMetadata => ({
  title: null,
  targetKind: null,
  targetReference: null,
  errorMessage
});

const parsePublicBugBundleMetadata = (payload: unknown): SubmissionPublicMetadata => {
  if (!isRecord(payload) || !isRecord(payload.core) || !isRecord(payload.core.submission)) {
    return emptyPublicMetadata("BugBundle public metadata was not in the expected shape.");
  }

  const submission = payload.core.submission;
  const target = isRecord(submission.target) ? submission.target : {};
  const rawTargetKind = trimmedString(target.kind, 40);

  return {
    title: trimmedString(submission.title, MAX_PUBLIC_BUNDLE_TITLE_LENGTH),
    targetKind: rawTargetKind && isTargetKind(rawTargetKind) ? rawTargetKind : null,
    targetReference: trimmedString(target.reference, MAX_PUBLIC_BUNDLE_TARGET_LENGTH),
    errorMessage: null
  };
};

export const loadPublicBugBundleMetadata = async (
  publicSubmission: SubmissionPublic
): Promise<SubmissionPublicMetadata> => {
  if (!publicSubmission.encryptedPayloadCid) {
    return emptyPublicMetadata("Report does not include a BugBundle CID.");
  }

  const load = (async () => {
    try {
      const storage = activeStorageProvider();
      return parsePublicBugBundleMetadata(await downloadJson<unknown>(storage, publicSubmission.encryptedPayloadCid));
    } catch (error) {
      return emptyPublicMetadata(error instanceof Error ? error.message : "BugBundle public metadata could not be loaded.");
    }
  })();
  const timeout = new Promise<SubmissionPublicMetadata>((resolve) => {
    window.setTimeout(
      () => resolve(emptyPublicMetadata("BugBundle public metadata load timed out.")),
      PUBLIC_BUNDLE_METADATA_TIMEOUT_MS
    );
  });

  return Promise.race([load, timeout]);
};

const enrichPublicSubmission = async (publicSubmission: SubmissionPublic): Promise<SubmissionBundle> => ({
  publicSubmission,
  publicMetadata: await loadPublicBugBundleMetadata(publicSubmission)
});

export const loadSubmissionBundle = async (reportHash: `0x${string}`): Promise<SubmissionBundle | null> => {
  const publicSubmission = await getBugReport(reportHash);
  if (!publicSubmission) {
    return null;
  }

  return enrichPublicSubmission(publicSubmission);
};

export const loadRecentBundles = async (limit: number): Promise<SubmissionBundle[]> =>
  Promise.all((await getLatestBugReports(limit)).map(enrichPublicSubmission));

export const loadReviewQueue = async (limit: number) => {
  const bundles = await loadRecentBundles(limit);
  return Promise.all(
    bundles.map(async (bundle) => {
      const reviews = await getReviewVerdictsByReportHash(bundle.publicSubmission.reportHash);
      return {
        bundle,
        reviewState: computeReviewDisplayState(reviews)
      };
    })
  );
};

export const decryptPrivateSubmission = async (
  encryptedPayloadCid: string,
  accessKey: string
): Promise<SubmissionPrivate> => {
  const storage = activeStorageProvider();
  const envelope = await downloadJson<EncryptedEnvelope>(storage, encryptedPayloadCid);
  return decryptJson<SubmissionPrivate>(envelope, accessKey);
};

export const getStoredAccessKey = (reportHash: string): string | null => getReportAccessKey(reportHash);

export const submitReviewVerdict = async (
  reportHash: `0x${string}`,
  input: ReviewFormInput
): Promise<{ attestationUid: `0x${string}`; noteCid: string }> => {
  const storage = activeStorageProvider();
  let noteCid = "";

  if (input.note.trim()) {
    const noteUpload = await uploadJson(
      storage,
      {
        note: input.note.trim(),
        createdAt: new Date().toISOString()
      },
      `${reportHash.slice(2, 10)}-review-note.json`
    );
    noteCid = noteUpload.uri;
  }

  const attestationUid = await createReviewVerdictAttestation({
    reportHash,
    validity: input.validity,
    impact: input.impact,
    rewardClass: input.rewardClass,
    confidence: input.confidence,
    noteCid
  });

  return { attestationUid, noteCid };
};

export const loadReviewVerdicts = async (reportHash: `0x${string}`): Promise<ReviewVerdict[]> =>
  getReviewVerdictsByReportHash(reportHash);
