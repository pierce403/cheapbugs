import { expect, test } from "@playwright/test";

import { reportDetailsUnlockText } from "../src/lib/reportDisplay";
import type { SubmissionBundle } from "../src/types/submission";

const bundleWithRevealAfter = (revealAfter: string): SubmissionBundle => ({
  publicSubmission: {
    reportId: "CB-TZ-0001",
    reportHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    reporterAddress: "0x1234567890123456789012345678901234567890",
    createdAt: "2026-05-26T02:21:52.000Z",
    disclosureMode: "private",
    publicSummary: "Timezone regression fixture.",
    encryptedPayloadCid: "ipfs://bafytzfixture",
    targetKind: "other",
    targetRefHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    tags: [],
    contentHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    bugBundleHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    encryptedDetailsHash: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    detailsKeyCommitment: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    revealAfter,
    detailsKeyRevealed: false
  },
  publicMetadata: {
    title: "Timezone regression fixture",
    targetKind: "other",
    targetReference: "fixture",
    errorMessage: null,
    status: "ready"
  }
});

test("near-term unlock text uses DST-aware local timezone labels", () => {
  const originalDateNow = Date.now;
  const originalTimezone = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  Date.now = () => 1_780_370_201_000;
  try {
    const text = reportDetailsUnlockText(bundleWithRevealAfter("2026-06-02T03:21:52.000Z"));
    expect(text).toContain("8:21 PM PDT");
    expect(text).not.toContain("7:21 PM");
    expect(text).toContain("in 6m");
  } finally {
    Date.now = originalDateNow;
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  }
});
