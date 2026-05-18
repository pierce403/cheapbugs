import { privateKeyToAccount } from "viem/accounts";

import { env } from "../config/env";
import type { SubmissionFormInput } from "../lib/reports";
import { normalizeAddress, stableStringify } from "../lib/utils";
import { sendXmtpDm, type BrowserXmtpIdentity, type XmtpProgressHandler } from "./browser";

export const BROKER_SUBMISSION_SCHEMA = "cheapbugs.bug_submission.v1";
export const BROKER_SUBMISSION_VERSION = 1;
export const BROKER_SUBMISSION_SIGNATURE_SCHEME = "eip191_canonical_submission_v1";
const BROKER_IPFS_CONFIRMATION_PATTERN = /Encrypted BugBundle pinned to IPFS:\s*ipfs:\/\//i;
const BROKER_TERMINAL_FAILURE_PATTERN = new RegExp(
  [
    "Invalid JSON command",
    "JSON command must",
    "Missing required submission field",
    "Unexpected submission field",
    "Submission (?:schema|version|JSON) must",
    "Unsupported disclosure mode",
    "Submission reporter signature is invalid",
    "Submission (?:target|credentials) is invalid",
    "BugBundle IPFS publish failed"
  ].join("|"),
  "i"
);
const BROKER_IPFS_CONFIRMATION_TIMEOUT_MS = 120 * 1000;

type BrokerSubmissionPayload = {
  schema: typeof BROKER_SUBMISSION_SCHEMA;
  type: "submission";
  version: typeof BROKER_SUBMISSION_VERSION;
  reporter_address: `0x${string}`;
  broker_address: `0x${string}`;
  bug_type: SubmissionFormInput["bugType"];
  severity: SubmissionFormInput["severity"];
  target_interest: SubmissionFormInput["targetInterest"];
  title: string;
  public_summary: string;
  details: string;
  target: {
    kind: "other";
    reference: "broker triage";
  };
  disclosure_mode: "private";
  tags: string[];
  client: {
    name: "cheapbugs-web";
    sent_at: string;
  };
};

type BrokerSubmissionSignature = {
  scheme: typeof BROKER_SUBMISSION_SIGNATURE_SCHEME;
  signer: `0x${string}`;
  payload_sha256: `0x${string}`;
  message: string;
  value: `0x${string}`;
};

export const isBrokerConfigured = (): boolean => Boolean(env.brokerXmtpAddress);

const extractIpfsUri = (text?: string): string | undefined => {
  const match = text?.match(/ipfs:\/\/[^\s)]+/i);
  return match?.[0].replace(/[.,;:]+$/, "");
};

const bytesToHex = (bytes: Uint8Array): `0x${string}` =>
  `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;

const sha256Hex = async (value: string): Promise<`0x${string}`> => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
};

const buildSignatureMessage = (payload: BrokerSubmissionPayload, payloadSha256: `0x${string}`): string =>
  [
    "CheapBugs broker submission authorization",
    "",
    "This signature authorizes the configured CheapBugs broker to validate and pin one encrypted BugBundle for this submission.",
    "",
    `schema: ${payload.schema}`,
    `version: ${payload.version}`,
    `reporter: ${payload.reporter_address}`,
    `broker: ${payload.broker_address}`,
    `payload_sha256: ${payloadSha256}`
  ].join("\n");

const buildUnsignedBrokerSubmissionPayload = (
  input: SubmissionFormInput,
  reporterAddress: `0x${string}`
): BrokerSubmissionPayload => ({
  schema: BROKER_SUBMISSION_SCHEMA,
  type: "submission",
  version: BROKER_SUBMISSION_VERSION,
  reporter_address: normalizeAddress(reporterAddress),
  broker_address: normalizeAddress(env.brokerXmtpAddress),
  bug_type: input.bugType,
  severity: input.severity,
  target_interest: input.targetInterest,
  title: input.title.trim(),
  public_summary: input.publicSummary.trim(),
  details: input.details.trim(),
  target: {
    kind: "other",
    reference: "broker triage"
  },
  disclosure_mode: "private",
  tags: [],
  client: {
    name: "cheapbugs-web",
    sent_at: new Date().toISOString()
  }
});

const signBrokerSubmissionPayload = async (
  identity: BrowserXmtpIdentity,
  payload: BrokerSubmissionPayload,
  onProgress?: XmtpProgressHandler
): Promise<BrokerSubmissionSignature> => {
  const payloadSha256 = await sha256Hex(stableStringify(payload));
  const message = buildSignatureMessage(payload, payloadSha256);

  if (identity.privateKey) {
    onProgress?.("signing broker submission with local key");
    const account = privateKeyToAccount(identity.privateKey);
    return {
      scheme: BROKER_SUBMISSION_SIGNATURE_SCHEME,
      signer: normalizeAddress(account.address),
      payload_sha256: payloadSha256,
      message,
      value: await account.signMessage({ message })
    };
  }

  if (!identity.signMessage) {
    throw new Error("XMTP identity cannot sign the broker submission authorization.");
  }

  onProgress?.("waiting for broker submission signature");
  const value = (await identity.signMessage(message)) as `0x${string}`;
  onProgress?.("broker submission signature approved");
  return {
    scheme: BROKER_SUBMISSION_SIGNATURE_SCHEME,
    signer: payload.reporter_address,
    payload_sha256: payloadSha256,
    message,
    value
  };
};

export const buildBrokerSubmissionMessage = async (
  input: SubmissionFormInput,
  identity: BrowserXmtpIdentity,
  onProgress?: XmtpProgressHandler
): Promise<string> => {
  const payload = buildUnsignedBrokerSubmissionPayload(input, identity.address);
  const signature = await signBrokerSubmissionPayload(identity, payload, onProgress);
  return stableStringify({
    ...payload,
    signature
  });
};

export const sendBrokerSubmission = async (
  identity: BrowserXmtpIdentity,
  input: SubmissionFormInput,
  onProgress?: XmtpProgressHandler
) => {
  if (!env.brokerXmtpAddress) {
    throw new Error("Set VITE_BROKER_XMTP_ADDRESS before sending XMTP submissions.");
  }

  const message = await buildBrokerSubmissionMessage(input, identity, onProgress);
  const result = await sendXmtpDm(identity, env.brokerXmtpAddress, message, onProgress, {
    completionPattern: BROKER_IPFS_CONFIRMATION_PATTERN,
    failurePattern: BROKER_TERMINAL_FAILURE_PATTERN,
    timeoutMs: BROKER_IPFS_CONFIRMATION_TIMEOUT_MS,
    waitingMessage: "waiting for broker validation and IPFS publish",
    onReply: (message) => onProgress?.(`broker: ${message}`)
  });
  return {
    ...result,
    ipfsUri: extractIpfsUri(result.completionText)
  };
};
