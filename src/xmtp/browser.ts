import { toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { normalizeAddress } from "../lib/utils";

export type BrowserXmtpIdentity = {
  address: `0x${string}`;
  privateKey?: `0x${string}`;
  signMessage?: (message: string) => Promise<string>;
};

export type XmtpProgressHandler = (message: string) => void;

type XmtpClientCache = {
  address: `0x${string}`;
  client: any;
};
type SignatureCacheEntry = {
  signature: string;
  validUntilMs: number;
};

let clientCache: XmtpClientCache | null = null;
const signatureCache = new Map<string, SignatureCacheEntry>();
const signatureInFlight = new Map<string, Promise<string>>();

const SIGNATURE_CACHE_FALLBACK_MS = 5 * 60 * 1000;
const SIGNATURE_REFRESH_SKEW_MS = 60 * 1000;

const toIdentifierHex = (address: string): string =>
  address.startsWith("0x") || address.startsWith("0X") ? address.slice(2).toLowerCase() : address.toLowerCase();

const signatureFingerprint = (message: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < message.length; index += 1) {
    hash ^= message.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const signatureExpiry = (message: string): number => {
  const now = Date.now();
  const isoMatch = message.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/i);
  const parsed = isoMatch ? Date.parse(isoMatch[0]) : NaN;
  return Number.isFinite(parsed) && parsed > now ? parsed : now + SIGNATURE_CACHE_FALLBACK_MS;
};

const cachedSignMessage = async (
  namespace: string,
  message: string,
  signMessage: (message: string) => Promise<string>,
  onProgress?: XmtpProgressHandler
): Promise<string> => {
  const cacheKey = `${namespace}:${signatureFingerprint(message)}`;
  const now = Date.now();
  const cached = signatureCache.get(cacheKey);
  if (cached && cached.validUntilMs - SIGNATURE_REFRESH_SKEW_MS > now) {
    onProgress?.("using cached XMTP wallet signature");
    return cached.signature;
  }

  const pending = signatureInFlight.get(cacheKey);
  if (pending) {
    onProgress?.("waiting for in-flight XMTP wallet signature");
    return pending;
  }

  const pendingSignature = (async () => {
    onProgress?.("waiting for XMTP wallet signature");
    try {
      const signature = await signMessage(message);
      signatureCache.set(cacheKey, {
        signature,
        validUntilMs: signatureExpiry(message)
      });
      onProgress?.("XMTP wallet signature approved");
      return signature;
    } finally {
      signatureInFlight.delete(cacheKey);
    }
  })();
  signatureInFlight.set(cacheKey, pendingSignature);
  return pendingSignature;
};

const loadSdk = async (onProgress?: XmtpProgressHandler) => {
  try {
    onProgress?.("loading XMTP browser SDK");
    return await import("@xmtp/browser-sdk");
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `XMTP browser SDK failed to load: ${error.message}`
        : "XMTP browser SDK failed to load."
    );
  }
};

const createSigner = async (sdk: any, identity: BrowserXmtpIdentity, onProgress?: XmtpProgressHandler) => {
  onProgress?.("preparing XMTP signer");
  const address = normalizeAddress(identity.address);

  if (identity.privateKey) {
    const account = privateKeyToAccount(identity.privateKey);
    return {
      type: "EOA" as const,
      getIdentifier: () => ({
        identifier: account.address.toLowerCase(),
        identifierKind: sdk.IdentifierKind.Ethereum
      }),
      signMessage: async (message: string) => {
        onProgress?.("signing XMTP registration with local key");
        return toBytes(await account.signMessage({ message }));
      }
    };
  }

  if (identity.signMessage) {
    const namespace = `wallet:${address.toLowerCase()}`;
    return {
      type: "EOA" as const,
      getIdentifier: () => ({
        identifier: address.toLowerCase(),
        identifierKind: sdk.IdentifierKind.Ethereum
      }),
      signMessage: async (message: string) =>
        toBytes(await cachedSignMessage(namespace, message, identity.signMessage!, onProgress))
    };
  }

  throw new Error("XMTP identity needs either a local private key or wallet signing support.");
};

const clientIsRegistered = async (client: any): Promise<boolean> => {
  if (typeof client.isRegistered === "function") {
    return Boolean(await client.isRegistered().catch(() => false));
  }
  return Boolean(client.isRegistered);
};

export const connectBrowserXmtp = async (
  identity: BrowserXmtpIdentity,
  onProgress?: XmtpProgressHandler,
  loadedSdk?: any
) => {
  const address = normalizeAddress(identity.address);
  if (clientCache?.address === address) {
    onProgress?.("using existing XMTP connection");
    return clientCache.client;
  }

  const sdk = loadedSdk ?? (await loadSdk(onProgress));
  const signer = await createSigner(sdk, { ...identity, address }, onProgress);
  const loggingLevel = sdk.LogLevel?.Off ?? 0;
  const dbPath = `cheapbugs-xmtp-production-${address}.db3`;
  onProgress?.("connecting to XMTP network");
  const client = await sdk.Client.create(signer, {
    env: "production",
    dbPath,
    loggingLevel,
    structuredLogging: false,
    performanceLogging: false,
    disableAutoRegister: true
  });

  const registered = await clientIsRegistered(client);
  if (registered) {
    onProgress?.("XMTP identity already registered");
  } else {
    onProgress?.("registering XMTP identity");
    await client.register();
    if (!client.inboxId) {
      throw new Error("XMTP registration completed without an inbox ID.");
    }
    onProgress?.("XMTP identity registered");
  }
  clientCache = { address, client };
  return client;
};

export const sendXmtpDm = async (
  identity: BrowserXmtpIdentity,
  recipientAddress: `0x${string}`,
  message: string,
  onProgress?: XmtpProgressHandler
): Promise<{ conversationId: string; messageId: string }> => {
  const sdk = await loadSdk(onProgress);
  const client = await connectBrowserXmtp(identity, onProgress, sdk);
  const recipient = normalizeAddress(recipientAddress);
  const recipientIdentifiers = [
    {
      identifier: toIdentifierHex(recipient),
      identifierKind: sdk.IdentifierKind.Ethereum
    },
    {
      identifier: recipient.toLowerCase(),
      identifierKind: sdk.IdentifierKind.Ethereum
    }
  ];

  onProgress?.("checking broker XMTP inbox");
  let inboxId: string | null = null;
  for (const identifier of recipientIdentifiers) {
    inboxId =
      (await client.fetchInboxIdByIdentifier(identifier).catch(() => null)) ??
      (await sdk.getInboxIdForIdentifier(identifier, "production").catch(() => null));
    if (inboxId) {
      break;
    }
  }
  if (!inboxId) {
    throw new Error(`The configured broker wallet ${recipient} does not have a reachable XMTP inbox on production.`);
  }

  onProgress?.("opening broker DM");
  const dm = await client.conversations.createDm(inboxId);
  onProgress?.("sending broker submission");
  const messageId = await dm.sendText(message);
  onProgress?.("broker submission sent");
  return {
    conversationId: dm.id,
    messageId
  };
};
