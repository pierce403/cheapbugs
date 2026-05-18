import { env } from "../config/env";
import type { SubmissionFormInput } from "../lib/reports";
import { stableStringify } from "../lib/utils";

import { sendXmtpDm, type BrowserXmtpIdentity, type XmtpProgressHandler } from "./browser";

export const BROKER_SUBMISSION_SCHEMA = "cheapbugs.bug_submission.v1";
export const BROKER_SUBMISSION_VERSION = 1;
const BROKER_IPFS_CONFIRMATION_PATTERN = /Encrypted BugBundle pinned to IPFS:\s*ipfs:\/\//i;
const BROKER_TERMINAL_FAILURE_PATTERN = new RegExp(
  [
    "Invalid JSON command",
    "JSON command must",
    "Missing required submission field",
    "Unexpected submission field",
    "Submission (?:schema|version|JSON) must",
    "Unsupported disclosure mode",
    "Submission (?:target|credentials) is invalid",
    "BugBundle IPFS publish failed"
  ].join("|"),
  "i"
);
const BROKER_IPFS_CONFIRMATION_TIMEOUT_MS = 120 * 1000;

export const isBrokerConfigured = (): boolean => Boolean(env.brokerXmtpAddress);

const extractIpfsUri = (text?: string): string | undefined => {
  const match = text?.match(/ipfs:\/\/[^\s)]+/i);
  return match?.[0].replace(/[.,;:]+$/, "");
};

export const buildBrokerSubmissionMessage = (
  input: SubmissionFormInput,
  reporterAddress: `0x${string}`
): string =>
  stableStringify({
    schema: BROKER_SUBMISSION_SCHEMA,
    type: "submission",
    version: BROKER_SUBMISSION_VERSION,
    reporter_address: reporterAddress.toLowerCase(),
    bug_type: input.bugType,
    severity: input.severity,
    target_interest: input.targetInterest,
    title: input.title.trim(),
    public_summary: input.publicSummary.trim(),
    details: input.details.trim(),
    client: {
      name: "cheapbugs-web",
      sent_at: new Date().toISOString()
    }
  });

export const sendBrokerSubmission = async (
  identity: BrowserXmtpIdentity,
  input: SubmissionFormInput,
  onProgress?: XmtpProgressHandler
) => {
  if (!env.brokerXmtpAddress) {
    throw new Error("Set VITE_BROKER_XMTP_ADDRESS before sending XMTP submissions.");
  }

  const message = buildBrokerSubmissionMessage(input, identity.address);
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
