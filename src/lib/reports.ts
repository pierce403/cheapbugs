import type { ReviewVerdict } from "../types/review";
import type { BugType, SubmissionBundle, SubmissionPrivate, SubmissionRating } from "../types/submission";
import type { DisclosureMode, Impact, RewardClass, TargetKind, Validity } from "../types/domain";

import { createReviewVerdictAttestation } from "../attest/eas";
import { getBugReport, getLatestBugReports } from "../contracts/bugIndex";
import { activeStorageProvider } from "../storage";
import { decryptJson, type EncryptedEnvelope } from "./crypto";
import { computeReviewDisplayState, getReviewVerdictsByReportHash } from "./eas";
import { downloadJson, uploadJson } from "./ipfs";
import { getReportAccessKey } from "./report-access";

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

export const loadSubmissionBundle = async (reportHash: `0x${string}`): Promise<SubmissionBundle | null> => {
  const publicSubmission = await getBugReport(reportHash);
  if (!publicSubmission) {
    return null;
  }

  return {
    publicSubmission
  };
};

export const loadRecentBundles = async (limit: number): Promise<SubmissionBundle[]> =>
  (await getLatestBugReports(limit)).map((publicSubmission) => ({ publicSubmission }));

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
