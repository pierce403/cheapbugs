import { bytesToHex } from "viem";
import { english, generateMnemonic, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";

import { normalizeAddress } from "../lib/utils";

const LOCAL_IDENTITY_KEY = "cheapbugs.localXmtpIdentity.v1";
const DERIVATION_PATH = "m/44'/60'/0'/0/0";
const CHEAPBUGS_KEY_SCHEMA = "cheapbugs-key.v1";

export type LocalXmtpIdentity = {
  address: `0x${string}`;
  privateKey: `0x${string}`;
  mnemonic: string;
  derivationPath: string;
  createdAt: string;
  inboxId?: string;
};

export type CheapBugsKeyFile = {
  schema: typeof CHEAPBUGS_KEY_SCHEMA;
  type: "embedded_wallet";
  address: `0x${string}`;
  privateKey: `0x${string}`;
  mnemonic: string;
  derivationPath: string;
  createdAt: string;
  exportedAt: string;
  inboxId?: string;
};

const hasStorage = (): boolean => typeof window !== "undefined" && Boolean(window.localStorage);

const identityFromParsed = (parsed: Partial<LocalXmtpIdentity | CheapBugsKeyFile>): LocalXmtpIdentity => {
  if (!parsed.privateKey || typeof parsed.privateKey !== "string") {
    throw new Error("cheapbugs-key.json is missing a private key.");
  }

  const normalizedPrivateKey = parsed.privateKey.startsWith("0x")
    ? parsed.privateKey
    : (`0x${parsed.privateKey}` as `0x${string}`);
  const account = privateKeyToAccount(normalizedPrivateKey as `0x${string}`);
  const address = normalizeAddress(account.address);
  if (parsed.address && address !== normalizeAddress(parsed.address as `0x${string}`)) {
    throw new Error("cheapbugs-key.json address does not match its private key.");
  }

  return {
    address,
    privateKey: normalizedPrivateKey as `0x${string}`,
    mnemonic: typeof parsed.mnemonic === "string" ? parsed.mnemonic : "",
    derivationPath: typeof parsed.derivationPath === "string" ? parsed.derivationPath : DERIVATION_PATH,
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
    inboxId: typeof parsed.inboxId === "string" ? parsed.inboxId : undefined
  };
};

const parseIdentity = (raw: string | null): LocalXmtpIdentity | null => {
  if (!raw) {
    return null;
  }

  try {
    return identityFromParsed(JSON.parse(raw) as Partial<LocalXmtpIdentity | CheapBugsKeyFile>);
  } catch {
    return null;
  }
};

export const loadLocalXmtpIdentity = (): LocalXmtpIdentity | null => {
  if (!hasStorage()) {
    return null;
  }
  return parseIdentity(window.localStorage.getItem(LOCAL_IDENTITY_KEY));
};

export const saveLocalXmtpIdentity = (identity: LocalXmtpIdentity): void => {
  if (!hasStorage()) {
    return;
  }
  window.localStorage.setItem(LOCAL_IDENTITY_KEY, JSON.stringify(identity));
};

export const clearLocalXmtpIdentity = (): void => {
  if (!hasStorage()) {
    return;
  }
  window.localStorage.removeItem(LOCAL_IDENTITY_KEY);
};

export const createLocalXmtpIdentity = (): LocalXmtpIdentity => {
  const mnemonic = generateMnemonic(english);
  const account = mnemonicToAccount(mnemonic, { path: DERIVATION_PATH });
  const privateKeyBytes = account.getHdKey().privateKey;
  if (!privateKeyBytes) {
    throw new Error("Unable to derive a private key for the embedded CheapBugs wallet.");
  }

  const identity: LocalXmtpIdentity = {
    address: normalizeAddress(account.address),
    privateKey: bytesToHex(privateKeyBytes),
    mnemonic,
    derivationPath: DERIVATION_PATH,
    createdAt: new Date().toISOString()
  };
  saveLocalXmtpIdentity(identity);
  return identity;
};

export const toCheapBugsKeyFile = (identity: LocalXmtpIdentity): CheapBugsKeyFile => ({
  schema: CHEAPBUGS_KEY_SCHEMA,
  type: "embedded_wallet",
  address: identity.address,
  privateKey: identity.privateKey,
  mnemonic: identity.mnemonic,
  derivationPath: identity.derivationPath,
  createdAt: identity.createdAt,
  exportedAt: new Date().toISOString(),
  inboxId: identity.inboxId
});

export const serializeCheapBugsKeyFile = (identity: LocalXmtpIdentity): string =>
  `${JSON.stringify(toCheapBugsKeyFile(identity), null, 2)}\n`;

export const parseCheapBugsKeyFile = (raw: string): LocalXmtpIdentity => {
  let parsed: Partial<LocalXmtpIdentity | CheapBugsKeyFile>;
  try {
    parsed = JSON.parse(raw) as Partial<LocalXmtpIdentity | CheapBugsKeyFile>;
  } catch {
    throw new Error("cheapbugs-key.json is not valid JSON.");
  }

  if ("schema" in parsed && parsed.schema !== CHEAPBUGS_KEY_SCHEMA) {
    throw new Error("cheapbugs-key.json has an unsupported schema.");
  }

  if ("type" in parsed && parsed.type !== "embedded_wallet") {
    throw new Error("cheapbugs-key.json is not an embedded wallet key.");
  }

  return identityFromParsed(parsed);
};

export const importLocalXmtpIdentity = (raw: string): LocalXmtpIdentity => {
  const identity = parseCheapBugsKeyFile(raw);
  saveLocalXmtpIdentity(identity);
  return identity;
};
