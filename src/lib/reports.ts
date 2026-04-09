import { activeStorageProvider } from "../storage";
import type { ReviewVerdict } from "../types/review";
import type { SubmissionBundle, SubmissionPrivate, SubmissionPublic } from "../types/submission";
import type { DisclosureMode, Impact, RewardClass, TargetKind, Validity } from "../types/domain";

import { createReviewVerdictAttestation } from "../attest/eas";
import { getBugReport, getLatestBugReports, submitBugReportOnChain } from "../contracts/bugIndex";
import { decryptJson, type EncryptedEnvelope, encryptJson, computePrivateContentHash } from "./crypto";
import { computeReviewDisplayState, getReviewVerdictsByReportHash } from "./eas";
import { downloadJson, uploadJson } from "./ipfs";
import { getReportAccessKey, saveReportAccessKey } from "./report-access";
import { hashJson, hashText, normalizeAddress, parseTags, toReportId } from "./utils";

export type SubmissionFormInput = {
  title: string;
  publicSummary: string;
  details: string;
  reproSteps: string;
  evidence: string;
  suggestedSeverity: string;
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

export const submitReport = async (
  input: SubmissionFormInput,
  reporterAddress: `0x${string}`,
  accessKey: string
) => {
  const createdAt = new Date().toISOString();
  const privateSubmission: SubmissionPrivate = {
    title: input.title.trim(),
    details: input.details.trim(),
    reproSteps: input.reproSteps.trim(),
    evidence: input.evidence.trim(),
    suggestedSeverity: input.suggestedSeverity.trim(),
    contactHints: input.contactHints.trim(),
    targetRef: input.targetRef.trim()
  };

  const contentHash = computePrivateContentHash(privateSubmission);
  const targetRefHash = hashText(privateSubmission.targetRef.toLowerCase());
  const reportHash = hashJson({
    reporterAddress,
    createdAt,
    contentHash,
    targetRefHash,
    publicSummary: input.publicSummary.trim()
  });
  const reportId = toReportId(reportHash);
  const storage = activeStorageProvider();
  const encrypted = await encryptJson(privateSubmission, accessKey);
  const privateUpload = await uploadJson(storage, encrypted, `${reportId}-private.json`);

  const publicSubmission: SubmissionPublic = {
    reportId,
    reportHash,
    reporterAddress: normalizeAddress(reporterAddress),
    createdAt,
    disclosureMode: input.disclosureMode,
    publicSummary: input.publicSummary.trim(),
    encryptedPayloadCid: privateUpload.uri,
    targetKind: input.targetKind,
    targetRefHash,
    tags: parseTags(input.tags),
    contentHash
  };

  const { txHash } = await submitBugReportOnChain(publicSubmission);

  saveReportAccessKey(reportHash, accessKey);

  return {
    reportHash,
    reportId,
    txHash,
    publicSubmission,
    encryptedPayloadCid: privateUpload.uri,
    accessKey,
    storageProvider: storage.label
  };
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
