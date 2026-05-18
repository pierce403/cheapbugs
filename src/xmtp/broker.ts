import { privateKeyToAccount } from "viem/accounts";

import { env } from "../config/env";
import type { SubmissionFormInput } from "../lib/reports";
import { normalizeAddress, stableStringify } from "../lib/utils";
import { sendXmtpDm, type BrowserXmtpIdentity, type XmtpProgressHandler } from "./browser";

export const BROKER_SUBMISSION_SCHEMA = "cheapbugs.bug_submission.v1";
export const BROKER_SUBMISSION_VERSION = 1;
export const BUG_BUNDLE_SCHEMA = "cheapbugs.bug_bundle.v1";
export const BUG_BUNDLE_VERSION = 1;
export const BUG_BUNDLE_SIGNATURE_SCHEME = "eip191_bugbundle_core_v1";
const BROKER_IPFS_CONFIRMATION_PATTERN = /Encrypted BugBundle pinned to IPFS:\s*ipfs:\/\//i;
const BROKER_TERMINAL_FAILURE_PATTERN = new RegExp(
  [
    "Invalid JSON command",
    "JSON command must",
    "Missing required submission field",
    "Unexpected submission field",
    "Submission (?:schema|version|JSON) must",
    "Unsupported disclosure mode",
    "BugBundle signature is invalid",
    "BugBundle is invalid",
    "Submission (?:target|credentials) is invalid",
    "BugBundle IPFS publish failed"
  ].join("|"),
  "i"
);
const BROKER_IPFS_CONFIRMATION_TIMEOUT_MS = 120 * 1000;
const BUG_BUNDLE_REVEAL_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

type BugBundleCore = {
  schema: typeof BUG_BUNDLE_SCHEMA;
  version: typeof BUG_BUNDLE_VERSION;
  type: "publisher_submission";
  reporter: `0x${string}`;
  broker: `0x${string}`;
  chain_id: number;
  bug_index: `0x${string}` | "";
  created_at: string;
  reveal_after: string;
  submission: {
    bug_type: SubmissionFormInput["bugType"];
    severity: SubmissionFormInput["severity"];
    target_interest: SubmissionFormInput["targetInterest"];
    title: string;
    public_summary: string;
    target: {
      kind: "other";
      reference: "broker triage";
    };
    disclosure_mode: "private";
    tags: string[];
  };
  details: {
    encrypted: true;
    alg: "AES-256-GCM";
    iv: string;
    aad: string;
    ciphertext: string;
  };
  commitments: {
    encrypted_details_sha256: `0x${string}`;
    details_key_commitment: `0x${string}`;
    details_key_commitment_alg: "sha256";
  };
};

type BugBundleSignature = {
  scheme: typeof BUG_BUNDLE_SIGNATURE_SCHEME;
  signer: `0x${string}`;
  core_sha256: `0x${string}`;
  message: string;
  value: `0x${string}`;
};

type BugBundlePayload = {
  schema: typeof BUG_BUNDLE_SCHEMA;
  version: typeof BUG_BUNDLE_VERSION;
  core: BugBundleCore;
  signature: BugBundleSignature;
};

export const isBrokerConfigured = (): boolean => Boolean(env.brokerXmtpAddress);

const extractIpfsUri = (text?: string): string | undefined => {
  const match = text?.match(/ipfs:\/\/[^\s)]+/i);
  return match?.[0].replace(/[.,;:]+$/, "");
};

const bytesToHex = (bytes: Uint8Array): `0x${string}` =>
  `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

const sha256Hex = async (value: string): Promise<`0x${string}`> => {
  const bytes = new TextEncoder().encode(value);
  return sha256Bytes(bytes);
};

const sha256Bytes = async (bytes: Uint8Array): Promise<`0x${string}`> => {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return bytesToHex(new Uint8Array(digest));
};

const base64UrlEncode = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
};

const isoAfter = (createdAt: Date, delayMs: number): string => new Date(createdAt.getTime() + delayMs).toISOString();

const optionalAddress = (address: string): `0x${string}` | "" => (address ? normalizeAddress(address) : "");

const buildBugBundleSignatureMessage = (core: BugBundleCore, coreSha256: `0x${string}`): string =>
  [
    "CheapBugs BugBundle authorization",
    "",
    "This signature authorizes the configured CheapBugs broker to verify and pin one encrypted BugBundle.",
    "",
    `schema: ${core.schema}`,
    `version: ${core.version}`,
    `reporter: ${core.reporter}`,
    `broker: ${core.broker}`,
    `chain_id: ${core.chain_id}`,
    `bug_index: ${core.bug_index}`,
    `core_sha256: ${coreSha256}`,
    `encrypted_details_sha256: ${core.commitments.encrypted_details_sha256}`,
    `details_key_commitment: ${core.commitments.details_key_commitment}`,
    `reveal_after: ${core.reveal_after}`
  ].join("\n");

const buildUnsignedBugBundleCore = async (
  input: SubmissionFormInput,
  reporterAddress: `0x${string}`,
  brokerAddress: `0x${string}`,
  createdAt: Date
): Promise<{ core: BugBundleCore; detailsKeyB64: string }> => {
  const detailsKey = randomBytes(32);
  const iv = randomBytes(12);
  const submission = {
    bug_type: input.bugType,
    severity: input.severity,
    target_interest: input.targetInterest,
    title: input.title.trim(),
    public_summary: input.publicSummary.trim(),
    target: {
      kind: "other" as const,
      reference: "broker triage" as const
    },
    disclosure_mode: "private" as const,
    tags: []
  };
  const aadObject: Omit<BugBundleCore, "details" | "commitments"> = {
    schema: BUG_BUNDLE_SCHEMA,
    version: BUG_BUNDLE_VERSION,
    type: "publisher_submission" as const,
    reporter: normalizeAddress(reporterAddress),
    broker: normalizeAddress(brokerAddress),
    chain_id: env.chainId,
    bug_index: optionalAddress(env.bugIndexAddress),
    created_at: createdAt.toISOString(),
    reveal_after: isoAfter(createdAt, BUG_BUNDLE_REVEAL_DELAY_MS),
    submission
  };
  const aad = new TextEncoder().encode(stableStringify(aadObject));
  const detailsPlaintext = new TextEncoder().encode(
    stableStringify({
      details: input.details.trim(),
      repro_steps: "",
      evidence: "",
      contact_hints: ""
    })
  );
  const cryptoKey = await crypto.subtle.importKey("raw", toArrayBuffer(detailsKey), "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(aad)
      },
      cryptoKey,
      toArrayBuffer(detailsPlaintext)
    )
  );

  const core: BugBundleCore = {
    ...aadObject,
    details: {
      encrypted: true,
      alg: "AES-256-GCM",
      iv: base64UrlEncode(iv),
      aad: base64UrlEncode(aad),
      ciphertext: base64UrlEncode(ciphertext)
    },
    commitments: {
      encrypted_details_sha256: await sha256Bytes(ciphertext),
      details_key_commitment: await sha256Bytes(detailsKey),
      details_key_commitment_alg: "sha256"
    }
  };
  return {
    core,
    detailsKeyB64: base64UrlEncode(detailsKey)
  };
};

const signBugBundleCore = async (
  identity: BrowserXmtpIdentity,
  core: BugBundleCore,
  onProgress?: XmtpProgressHandler
): Promise<BugBundleSignature> => {
  const coreSha256 = await sha256Hex(stableStringify(core));
  const message = buildBugBundleSignatureMessage(core, coreSha256);

  if (identity.privateKey) {
    onProgress?.("signing BugBundle with local key");
    const account = privateKeyToAccount(identity.privateKey);
    return {
      scheme: BUG_BUNDLE_SIGNATURE_SCHEME,
      signer: normalizeAddress(account.address),
      core_sha256: coreSha256,
      message,
      value: await account.signMessage({ message })
    };
  }

  if (!identity.signMessage) {
    throw new Error("XMTP identity cannot sign the BugBundle authorization.");
  }

  onProgress?.("waiting for BugBundle signature");
  const value = (await identity.signMessage(message)) as `0x${string}`;
  onProgress?.("BugBundle signature approved");
  return {
    scheme: BUG_BUNDLE_SIGNATURE_SCHEME,
    signer: core.reporter,
    core_sha256: coreSha256,
    message,
    value
  };
};

const buildSignedBugBundle = async (
  input: SubmissionFormInput,
  identity: BrowserXmtpIdentity,
  onProgress?: XmtpProgressHandler
): Promise<{ bugBundle: BugBundlePayload; detailsKey: string }> => {
  const { core, detailsKeyB64 } = await buildUnsignedBugBundleCore(
    input,
    identity.address,
    env.brokerXmtpAddress,
    new Date()
  );
  const signature = await signBugBundleCore(identity, core, onProgress);
  return {
    bugBundle: {
      schema: BUG_BUNDLE_SCHEMA,
      version: BUG_BUNDLE_VERSION,
      core,
      signature
    },
    detailsKey: detailsKeyB64
  };
};

export const buildBrokerSubmissionMessage = async (
  input: SubmissionFormInput,
  identity: BrowserXmtpIdentity,
  onProgress?: XmtpProgressHandler
): Promise<string> => {
  const reporterAddress = normalizeAddress(identity.address);
  const brokerAddress = normalizeAddress(env.brokerXmtpAddress);
  const { bugBundle, detailsKey } = await buildSignedBugBundle(input, identity, onProgress);
  return stableStringify({
    schema: BROKER_SUBMISSION_SCHEMA,
    type: "submission",
    version: BROKER_SUBMISSION_VERSION,
    reporter_address: reporterAddress,
    broker_address: brokerAddress,
    bug_type: input.bugType,
    severity: input.severity,
    target_interest: input.targetInterest,
    title: input.title.trim(),
    public_summary: input.publicSummary.trim(),
    target: {
      kind: "other",
      reference: "broker triage"
    },
    disclosure_mode: "private",
    tags: [],
    bug_bundle: bugBundle,
    details_key: detailsKey,
    client: {
      name: "cheapbugs-web",
      sent_at: new Date().toISOString()
    }
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
