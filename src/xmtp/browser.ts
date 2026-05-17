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

let clientCache: XmtpClientCache | null = null;

const toIdentifierHex = (address: string): string =>
  address.startsWith("0x") || address.startsWith("0X") ? address.slice(2).toLowerCase() : address.toLowerCase();

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
      signMessage: async (message: string) => toBytes(await account.signMessage({ message }))
    };
  }

  if (identity.signMessage) {
    return {
      type: "EOA" as const,
      getIdentifier: () => ({
        identifier: address.toLowerCase(),
        identifierKind: sdk.IdentifierKind.Ethereum
      }),
      signMessage: async (message: string) => toBytes(await identity.signMessage!(message))
    };
  }

  throw new Error("XMTP identity needs either a local private key or wallet signing support.");
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

  onProgress?.("registering XMTP identity");
  await client.register();
  clientCache = { address, client };
  onProgress?.("XMTP identity registered");
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
  const identifier = {
    identifier: toIdentifierHex(recipient),
    identifierKind: sdk.IdentifierKind.Ethereum
  };

  onProgress?.("checking broker XMTP inbox");
  const inboxId =
    (await client.fetchInboxIdByIdentifier(identifier).catch(() => null)) ??
    (await sdk.getInboxIdForIdentifier(identifier, "production").catch(() => null));
  if (!inboxId) {
    throw new Error("The configured broker wallet does not have a reachable XMTP inbox yet.");
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
