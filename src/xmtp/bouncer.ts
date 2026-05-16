import { env } from "../config/env";
import type { SubmissionFormInput } from "../lib/reports";

import { sendXmtpDm, type BrowserXmtpIdentity } from "./browser";

export const isBouncerConfigured = (): boolean => Boolean(env.bouncerXmtpAddress);

export const buildBouncerSubmissionMessage = (
  input: SubmissionFormInput,
  reporterAddress: `0x${string}`,
  signalRecipient: string
): string => `
!submit
wallet: ${reporterAddress}
signal: ${signalRecipient}
title: ${input.title.trim()}
summary: ${input.publicSummary.trim()}
severity: ${input.suggestedSeverity.trim() || "unrated"}

target kind: ${input.targetKind}
target reference: ${input.targetRef.trim()}
disclosure mode: ${input.disclosureMode}
tags: ${input.tags.trim() || "-"}

details:
${input.details.trim()}

repro steps:
${input.reproSteps.trim()}

evidence:
${input.evidence.trim() || "-"}

contact hints:
${input.contactHints.trim() || "-"}
`.trim();

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
