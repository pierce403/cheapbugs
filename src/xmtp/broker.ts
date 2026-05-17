import { env } from "../config/env";
import type { SubmissionFormInput } from "../lib/reports";
import { stableStringify } from "../lib/utils";

import { sendXmtpDm, type BrowserXmtpIdentity } from "./browser";

export const BROKER_SUBMISSION_SCHEMA = "cheapbugs.bug_submission.v1";
export const BROKER_SUBMISSION_VERSION = 1;

export const isBrokerConfigured = (): boolean => Boolean(env.brokerXmtpAddress);

export const buildBrokerSubmissionMessage = (
  input: SubmissionFormInput,
  reporterAddress: `0x${string}`
): string =>
  stableStringify({
    schema: BROKER_SUBMISSION_SCHEMA,
    type: "submission",
    version: BROKER_SUBMISSION_VERSION,
    reporter_address: reporterAddress.toLowerCase(),
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
  input: SubmissionFormInput
) => {
  if (!env.brokerXmtpAddress) {
    throw new Error("Set VITE_BROKER_XMTP_ADDRESS before sending XMTP submissions.");
  }

  const message = buildBrokerSubmissionMessage(input, identity.address);
  return sendXmtpDm(identity, env.brokerXmtpAddress, message);
};
