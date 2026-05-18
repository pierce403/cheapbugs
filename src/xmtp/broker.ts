import { keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { env } from "../config/env";
import type { SubmissionFormInput } from "../lib/reports";
import { disclosureModeToIndex, hashJson, normalizeAddress, stableStringify, targetKindToIndex, toReportId } from "../lib/utils";
import { sendXmtpDm, type BrowserXmtpIdentity, type XmtpProgressHandler } from "./browser";

export const BROKER_SUBMISSION_SCHEMA = "cheapbugs.bug_submission.v1";
export const BROKER_SUBMISSION_VERSION = 1;
export const BUG_BUNDLE_SCHEMA = "cheapbugs.bug_bundle.v1";
export const BUG_BUNDLE_VERSION = 1;
export const PUBLISH_AUTHORIZATION_SCHEME = "eip712_publish_bug_v1";
const BROKER_IPFS_CONFIRMATION_PATTERN = /Encrypted BugBundle pinned to IPFS:\s*ipfs:\/\//i;
const BROKER_TERMINAL_FAILURE_PATTERN = new RegExp(
  [
    "Invalid JSON command",
    "JSON command must",
    "Missing required submission field",
    "Unexpected submission field",
    "Submission (?:schema|version|JSON) must",
    "Unsupported disclosure mode",
    "Publish authorization is invalid",
    "BugBundle is invalid",
    "Submission (?:target|credentials) is invalid",
    "BugBundle IPFS publish failed"
  ].join("|"),
  "i"
);
const BROKER_IPFS_CONFIRMATION_TIMEOUT_MS = 120 * 1000;
const BUG_BUNDLE_REVEAL_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
const PUBLISH_AUTHORIZATION_TTL_SECONDS = 24 * 60 * 60;
const PUBLISH_BUG_TYPES = {
  PublishBug: [
    { name: "reportHash", type: "bytes32" },
    { name: "reportIdHash", type: "bytes32" },
    { name: "reporter", type: "address" },
    { name: "createdAt", type: "uint64" },
    { name: "disclosureMode", type: "uint8" },
    { name: "publicSummaryHash", type: "bytes32" },
    { name: "targetKind", type: "uint8" },
    { name: "targetRefHash", type: "bytes32" },
    { name: "tagsHash", type: "bytes32" },
    { name: "contentHash", type: "bytes32" },
    { name: "bugBundleHash", type: "bytes32" },
    { name: "encryptedDetailsHash", type: "bytes32" },
    { name: "detailsKeyCommitment", type: "bytes32" },
    { name: "revealAfter", type: "uint64" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "broker", type: "address" }
  ]
} as const;

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

type PublishAuthorizationMessage = {
  reportHash: `0x${string}`;
  reportIdHash: `0x${string}`;
  reporter: `0x${string}`;
  createdAt: bigint;
  disclosureMode: number;
  publicSummaryHash: `0x${string}`;
  targetKind: number;
  targetRefHash: `0x${string}`;
  tagsHash: `0x${string}`;
  contentHash: `0x${string}`;
  bugBundleHash: `0x${string}`;
  encryptedDetailsHash: `0x${string}`;
  detailsKeyCommitment: `0x${string}`;
  revealAfter: bigint;
  nonce: bigint;
  deadline: bigint;
  broker: `0x${string}`;
};

type PublishAuthorization = {
  scheme: typeof PUBLISH_AUTHORIZATION_SCHEME;
  signer: `0x${string}`;
  domain: {
    name: "CheapBugsBugIndex";
    version: "1";
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  types: typeof PUBLISH_BUG_TYPES;
  primaryType: "PublishBug";
  message: Record<keyof PublishAuthorizationMessage, string | number | `0x${string}`>;
  value: `0x${string}`;
};

type BugBundlePayload = {
  schema: typeof BUG_BUNDLE_SCHEMA;
  version: typeof BUG_BUNDLE_VERSION;
  core: BugBundleCore;
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

const unixSeconds = (iso: string): bigint => BigInt(Math.floor(Date.parse(iso) / 1000));

const randomUint256 = (): bigint => BigInt(bytesToHex(randomBytes(32)));

const hashString = (value: string): `0x${string}` => keccak256(toBytes(value));

const serializableMessage = (
  message: PublishAuthorizationMessage
): Record<keyof PublishAuthorizationMessage, string | number | `0x${string}`> => ({
  reportHash: message.reportHash,
  reportIdHash: message.reportIdHash,
  reporter: message.reporter,
  createdAt: message.createdAt.toString(),
  disclosureMode: message.disclosureMode,
  publicSummaryHash: message.publicSummaryHash,
  targetKind: message.targetKind,
  targetRefHash: message.targetRefHash,
  tagsHash: message.tagsHash,
  contentHash: message.contentHash,
  bugBundleHash: message.bugBundleHash,
  encryptedDetailsHash: message.encryptedDetailsHash,
  detailsKeyCommitment: message.detailsKeyCommitment,
  revealAfter: message.revealAfter.toString(),
  nonce: message.nonce.toString(),
  deadline: message.deadline.toString(),
  broker: message.broker
});

const buildPublishAuthorizationMessage = (
  core: BugBundleCore,
  coreSha256: `0x${string}`,
  nonce: bigint,
  deadline: bigint
): PublishAuthorizationMessage => {
  const reportHash = hashJson({
    reporter: core.reporter,
    broker: core.broker,
    chain_id: core.chain_id,
    bug_index: core.bug_index,
    created_at: core.created_at,
    reveal_after: core.reveal_after,
    submission: core.submission,
    encrypted_details_sha256: core.commitments.encrypted_details_sha256,
    details_key_commitment: core.commitments.details_key_commitment
  });
  const reportId = toReportId(reportHash);

  return {
    reportHash,
    reportIdHash: hashString(reportId),
    reporter: core.reporter,
    createdAt: unixSeconds(core.created_at),
    disclosureMode: disclosureModeToIndex(core.submission.disclosure_mode),
    publicSummaryHash: hashString(core.submission.public_summary),
    targetKind: targetKindToIndex(core.submission.target.kind),
    targetRefHash: hashString(core.submission.target.reference.toLowerCase()),
    tagsHash: hashString(core.submission.tags.join(",")),
    contentHash: hashJson({
      submission: core.submission,
      encrypted_details_sha256: core.commitments.encrypted_details_sha256,
      details_key_commitment: core.commitments.details_key_commitment
    }),
    bugBundleHash: coreSha256,
    encryptedDetailsHash: core.commitments.encrypted_details_sha256,
    detailsKeyCommitment: core.commitments.details_key_commitment,
    revealAfter: unixSeconds(core.reveal_after),
    nonce,
    deadline,
    broker: core.broker
  };
};

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

const signPublishAuthorization = async (
  identity: BrowserXmtpIdentity,
  core: BugBundleCore,
  coreSha256: `0x${string}`,
  onProgress?: XmtpProgressHandler
): Promise<PublishAuthorization> => {
  if (!env.bugIndexAddress) {
    throw new Error("Set VITE_BUG_INDEX_ADDRESS before sending EIP-712 broker publish authorizations.");
  }

  const domain = {
    name: "CheapBugsBugIndex" as const,
    version: "1" as const,
    chainId: env.chainId,
    verifyingContract: normalizeAddress(env.bugIndexAddress)
  };
  const nonce = randomUint256();
  const deadline = BigInt(Math.floor(Date.now() / 1000) + PUBLISH_AUTHORIZATION_TTL_SECONDS);
  const message = buildPublishAuthorizationMessage(core, coreSha256, nonce, deadline);
  const signingRequest = {
    domain,
    types: PUBLISH_BUG_TYPES,
    primaryType: "PublishBug" as const,
    message
  };

  if (identity.privateKey) {
    onProgress?.("signing PublishBug authorization with local key");
    const account = privateKeyToAccount(identity.privateKey);
    return {
      scheme: PUBLISH_AUTHORIZATION_SCHEME,
      signer: normalizeAddress(account.address),
      domain,
      types: PUBLISH_BUG_TYPES,
      primaryType: "PublishBug",
      message: serializableMessage(message),
      value: await account.signTypedData(signingRequest)
    };
  }

  if (!identity.signTypedData) {
    throw new Error("Wallet cannot sign the CheapBugs EIP-712 publish authorization.");
  }

  onProgress?.("waiting for PublishBug EIP-712 signature");
  const value = (await identity.signTypedData(signingRequest)) as `0x${string}`;
  onProgress?.("PublishBug authorization approved");
  return {
    scheme: PUBLISH_AUTHORIZATION_SCHEME,
    signer: core.reporter,
    domain,
    types: PUBLISH_BUG_TYPES,
    primaryType: "PublishBug",
    message: serializableMessage(message),
    value
  };
};

const buildAuthorizedBugBundle = async (
  input: SubmissionFormInput,
  identity: BrowserXmtpIdentity,
  onProgress?: XmtpProgressHandler
): Promise<{ bugBundle: BugBundlePayload; publishAuthorization: PublishAuthorization; detailsKey: string }> => {
  const { core, detailsKeyB64 } = await buildUnsignedBugBundleCore(
    input,
    identity.address,
    env.brokerXmtpAddress,
    new Date()
  );
  const coreSha256 = await sha256Hex(stableStringify(core));
  const publishAuthorization = await signPublishAuthorization(identity, core, coreSha256, onProgress);
  return {
    bugBundle: {
      schema: BUG_BUNDLE_SCHEMA,
      version: BUG_BUNDLE_VERSION,
      core
    },
    publishAuthorization,
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
  const { bugBundle, publishAuthorization, detailsKey } = await buildAuthorizedBugBundle(input, identity, onProgress);
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
    publish_authorization: publishAuthorization,
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
