import type { ReviewVerdict } from "../types/review";
import {
  BUG_TYPE_OPTIONS,
  SUBMISSION_RATING_VALUES,
  type BugType,
  type SubmissionBundle,
  type SubmissionPrivate,
  type SubmissionPublic,
  type SubmissionPublicMetadata,
  type SubmissionRating
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

const textDecoder = new TextDecoder();

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const base64UrlToBytes = (value: string): Uint8Array => {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};

const bytesToHex = (bytes: Uint8Array): `0x${string}` =>
  `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;

const sha256Bytes = async (bytes: Uint8Array): Promise<`0x${string}`> => {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return bytesToHex(new Uint8Array(digest));
};

const isBugBundlePayload = (payload: unknown): payload is Record<string, unknown> =>
  isRecord(payload) && isRecord(payload.core) && isRecord(payload.core.submission) && isRecord(payload.core.details);

const bugTypeValues = new Set<string>(BUG_TYPE_OPTIONS.map((option) => option.value));
const ratingValues = new Set<string>(SUBMISSION_RATING_VALUES);

const coerceBugType = (value: unknown): BugType =>
  typeof value === "string" && bugTypeValues.has(value) ? (value as BugType) : "0day";

const coerceRating = (value: unknown): SubmissionRating =>
  typeof value === "string" && ratingValues.has(value) ? (value as SubmissionRating) : "medium";

const decryptBugBundleDetails = async (
  payload: Record<string, unknown>,
  detailsKeyB64: string,
  expectedCommitments: Pick<SubmissionPublic, "encryptedDetailsHash" | "detailsKeyCommitment"> | null = null
): Promise<SubmissionPrivate> => {
  const core = payload.core as Record<string, unknown>;
  const submission = core.submission as Record<string, unknown>;
  const details = core.details as Record<string, unknown>;
  const target = isRecord(submission.target) ? submission.target : {};
  const commitments = isRecord(core.commitments) ? core.commitments : {};
  const key = base64UrlToBytes(detailsKeyB64.trim());
  const iv = base64UrlToBytes(String(details.iv ?? ""));
  const aad = base64UrlToBytes(String(details.aad ?? ""));
  const ciphertext = base64UrlToBytes(String(details.ciphertext ?? ""));
  const expectedKeyCommitment = (
    expectedCommitments?.detailsKeyCommitment ?? String(commitments.details_key_commitment ?? "")
  ).toLowerCase();
  const expectedCiphertextHash = (
    expectedCommitments?.encryptedDetailsHash ?? String(commitments.encrypted_details_sha256 ?? "")
  ).toLowerCase();

  if (key.byteLength !== 32) {
    throw new Error("BugBundle details key must be a base64url 32-byte key.");
  }
  if (expectedKeyCommitment && (await sha256Bytes(key)).toLowerCase() !== expectedKeyCommitment) {
    throw new Error("BugBundle details key does not match the key commitment.");
  }
  if (expectedCiphertextHash && (await sha256Bytes(ciphertext)).toLowerCase() !== expectedCiphertextHash) {
    throw new Error("BugBundle encrypted details hash does not match the commitment.");
  }

  const cryptoKey = await crypto.subtle.importKey("raw", toArrayBuffer(key), "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(aad)
    },
    cryptoKey,
    toArrayBuffer(ciphertext)
  );
  const parsed = JSON.parse(textDecoder.decode(plaintext)) as Record<string, unknown>;

  return {
    bugType: coerceBugType(submission.bug_type),
    title: String(submission.title ?? ""),
    details: String(parsed.details ?? ""),
    reproSteps: String(parsed.repro_steps ?? ""),
    evidence: String(parsed.evidence ?? ""),
    severity: coerceRating(submission.severity),
    targetInterest: coerceRating(submission.target_interest),
    contactHints: String(parsed.contact_hints ?? ""),
    targetRef: String(target.reference ?? "")
  };
};

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

const emptyPublicMetadata = (
  errorMessage: string | null = null,
  status: SubmissionPublicMetadata["status"] = "unavailable"
): SubmissionPublicMetadata => ({
  title: null,
  targetKind: null,
  targetReference: null,
  errorMessage,
  status
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
    errorMessage: null,
    status: "ready"
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
      return emptyPublicMetadata(
        error instanceof Error ? error.message : "BugBundle public metadata could not be loaded.",
        "loading"
      );
    }
  })();
  const timeout = new Promise<SubmissionPublicMetadata>((resolve) => {
    window.setTimeout(
      () => resolve(emptyPublicMetadata("BugBundle public metadata load timed out.", "loading")),
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
  accessKey: string,
  expectedCommitments: Pick<SubmissionPublic, "encryptedDetailsHash" | "detailsKeyCommitment"> | null = null
): Promise<SubmissionPrivate> => {
  const storage = activeStorageProvider();
  const payload = await downloadJson<EncryptedEnvelope | unknown>(storage, encryptedPayloadCid);
  if (isBugBundlePayload(payload)) {
    return decryptBugBundleDetails(payload, accessKey, expectedCommitments);
  }
  return decryptJson<SubmissionPrivate>(payload as EncryptedEnvelope, accessKey);
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
