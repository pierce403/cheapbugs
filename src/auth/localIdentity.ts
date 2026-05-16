import { bytesToHex } from "viem";
import { english, generateMnemonic, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";

import { normalizeAddress } from "../lib/utils";

const LOCAL_IDENTITY_KEY = "cheapbugs.localXmtpIdentity.v1";
const DERIVATION_PATH = "m/44'/60'/0'/0/0";

export type LocalXmtpIdentity = {
  address: `0x${string}`;
  privateKey: `0x${string}`;
  mnemonic: string;
  derivationPath: string;
  createdAt: string;
  inboxId?: string;
};

const hasStorage = (): boolean => typeof window !== "undefined" && Boolean(window.localStorage);

const parseIdentity = (raw: string | null): LocalXmtpIdentity | null => {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LocalXmtpIdentity>;
    if (!parsed.privateKey || !parsed.address) {
      return null;
    }
    const normalizedPrivateKey = parsed.privateKey.startsWith("0x")
      ? parsed.privateKey
      : (`0x${parsed.privateKey}` as `0x${string}`);
    const account = privateKeyToAccount(normalizedPrivateKey as `0x${string}`);
    const address = normalizeAddress(account.address);
    if (address !== normalizeAddress(parsed.address as `0x${string}`)) {
      return null;
    }

    return {
      address,
      privateKey: normalizedPrivateKey as `0x${string}`,
      mnemonic: parsed.mnemonic ?? "",
      derivationPath: parsed.derivationPath ?? DERIVATION_PATH,
      createdAt: parsed.createdAt ?? new Date().toISOString(),
      inboxId: parsed.inboxId
    };
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
    throw new Error("Unable to derive a private key for the local XMTP identity.");
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
