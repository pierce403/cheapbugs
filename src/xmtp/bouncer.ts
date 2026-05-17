import { env } from "../config/env";
import type { SubmissionFormInput } from "../lib/reports";
import { parseTags, stableStringify } from "../lib/utils";

import { sendXmtpDm, type BrowserXmtpIdentity } from "./browser";

export const BOUNCER_SUBMISSION_SCHEMA = "cheapbugs.bug_submission.v1";
export const BOUNCER_SUBMISSION_VERSION = 1;

export const isBouncerConfigured = (): boolean => Boolean(env.bouncerXmtpAddress);

export const buildBouncerSubmissionMessage = (
  input: SubmissionFormInput,
  reporterAddress: `0x${string}`,
  signalRecipient: string
): string =>
  stableStringify({
    schema: BOUNCER_SUBMISSION_SCHEMA,
    type: "submission",
    version: BOUNCER_SUBMISSION_VERSION,
    reporter_address: reporterAddress.toLowerCase(),
    signal_recipient: signalRecipient.trim(),
    title: input.title.trim(),
    public_summary: input.publicSummary.trim(),
    details: input.details.trim(),
    repro_steps: input.reproSteps.trim(),
    evidence: input.evidence.trim(),
    suggested_severity: input.suggestedSeverity.trim() || "unrated",
    target: {
      kind: input.targetKind,
      reference: input.targetRef.trim()
    },
    disclosure_mode: input.disclosureMode,
    tags: parseTags(input.tags),
    contact_hints: input.contactHints.trim(),
    client: {
      name: "cheapbugs-web",
      sent_at: new Date().toISOString()
    }
  });

export const sendBouncerSubmission = async (
  identity: BrowserXmtpIdentity,
  input: SubmissionFormInput,
  signalRecipient: string
) => {
  if (!env.bouncerXmtpAddress) {
    throw new Error("Set VITE_BOUNCER_XMTP_ADDRESS before sending XMTP submissions.");
  }

  const message = buildBouncerSubmissionMessage(input, identity.address, signalRecipient);
  return sendXmtpDm(identity, env.bouncerXmtpAddress, message);
};
