import { Wallet as EthersWallet, verifyMessage, type Signer } from "ethers";
import { createThirdwebClient } from "thirdweb";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";
import { autoConnect, createWallet, getInstalledWallets, walletConnect, type Wallet } from "thirdweb/wallets";

import { appChain, chainConfig } from "../config/chains";
import { env } from "../config/env";
import { isTrustedReviewer } from "../config/reviewers";
import { APP_METADATA } from "../lib/constants";
import { emptyEnsProfile, refreshEnsProfile as refreshEnsProfileFromNetwork, resolveEnsProfile } from "../lib/ens";
import { appLog } from "../lib/logger";
import { normalizeAddress, shortHash } from "../lib/utils";
import { createBaseReadProvider } from "../contracts/rpcProvider";
import type { SessionState } from "../types/app";
import type { HexString } from "../types/domain";
import type { BrowserXmtpIdentity } from "../xmtp/browser";

import {
  clearLocalXmtpIdentity,
  createLocalXmtpIdentity,
  loadLocalXmtpIdentity,
  saveLocalXmtpIdentity,
  type LocalXmtpIdentity
} from "./localIdentity";

type SessionListener = (session: SessionState) => void;
type WalletMode = Exclude<SessionState["mode"], null>;
type ExternalWalletMode = Exclude<WalletMode, "local">;
type SignableThirdwebAccount = {
  address: string;
  signMessage?: (args: { message: string; chainId?: number }) => Promise<string>;
};
type SiweSession = {
  version: "1";
  address: HexString;
  chainId: number;
  domain: string;
  uri: string;
  nonce: string;
  issuedAt: string;
  walletId: string;
  mode: Exclude<WalletMode, "local">;
  message: string;
  signature: HexString;
};
type PersistedWalletSession = {
  version: "1";
  address: HexString;
  chainId: number;
  connectedAt: string;
  domain: string;
  lastSeenAt: string;
  mode: ExternalWalletMode;
  uri: string;
  walletId: string;
};

const SIWE_SESSION_KEY = "cheapbugs.siweSession.v1";
const WALLET_SESSION_KEY = "cheapbugs.walletSession.v1";
const THIRDWEB_CONNECTED_WALLET_IDS_KEY = "thirdweb:connected-wallet-ids";
const THIRDWEB_ACTIVE_WALLET_ID_KEY = "thirdweb:active-wallet-id";
const THIRDWEB_ACTIVE_CHAIN_KEY = "thirdweb:active-chain";
const THIRDWEB_LAST_USED_WALLET_ID_KEY = "thirdweb:last-used-wallet-id";
const BASE_RPC_PROVIDER = createBaseReadProvider();
const wcWallet = walletConnect();
const thirdwebDisabledMessage =
  "Auth is unavailable because VITE_THIRDWEB_CLIENT_ID is not configured for this deployment.";

export const thirdwebClient = env.thirdwebClientId
  ? createThirdwebClient({
      clientId: env.thirdwebClientId
    })
  : null;

export const requireThirdwebClient = () => {
  if (!thirdwebClient) {
    throw new Error(thirdwebDisabledMessage);
  }
  return thirdwebClient;
};

const defaultSessionState = (): SessionState => ({
  status: "idle",
  walletId: null,
  address: null,
  mode: null,
  ...emptyEnsProfile(),
  siweMessage: null,
  siweSignature: null,
  siweIssuedAt: null,
  isReviewer: false,
  lastError: null
});

const hasStorage = (): boolean => typeof window !== "undefined" && Boolean(window.localStorage);

const currentSiweDomain = (): string => (typeof window === "undefined" ? "localhost" : window.location.host);

const currentSiweUri = (): string => (typeof window === "undefined" ? APP_METADATA.url : window.location.origin);

const isExternalMode = (value: unknown): value is ExternalWalletMode => value === "external";

const createNonce = (): string => {
  const bytes = new Uint8Array(16);
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const toHexString = (value: string, label: string): HexString => {
  if (!value.startsWith("0x")) {
    throw new Error(`${label} was not a hex string.`);
  }
  return value as HexString;
};

const buildSiweMessage = (session: Omit<SiweSession, "version" | "message" | "signature">): string => `${session.domain} wants you to sign in with your Ethereum account:
${session.address}

Sign in to CheapBugs. This signature does not authorize a transaction.

URI: ${session.uri}
Version: 1
Chain ID: ${session.chainId}
Nonce: ${session.nonce}
Issued At: ${session.issuedAt}`;

const siweFields = (
  siweSession: SiweSession | null
): Pick<SessionState, "siweMessage" | "siweSignature" | "siweIssuedAt"> => ({
  siweMessage: siweSession?.message ?? null,
  siweSignature: siweSession?.signature ?? null,
  siweIssuedAt: siweSession?.issuedAt ?? null
});

const readStoredJson = <T>(key: string, label: string): T | null => {
  if (!hasStorage()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (error) {
    appLog.warn(`${label}: failed to parse persisted storage`, error);
    return null;
  }
};

const parseStoredSiweSession = (): SiweSession | null => {
  const parsed = readStoredJson<Partial<SiweSession>>(SIWE_SESSION_KEY, "siwe");
  if (!parsed) {
    return null;
  }

  const parsedAddress =
    typeof parsed.address === "string" && parsed.address.startsWith("0x")
      ? normalizeAddress(parsed.address)
      : null;
  const domain = typeof parsed.domain === "string" ? parsed.domain : null;
  const uri = typeof parsed.uri === "string" ? parsed.uri : null;
  const nonce = typeof parsed.nonce === "string" ? parsed.nonce : null;
  const issuedAt = typeof parsed.issuedAt === "string" ? parsed.issuedAt : null;
  const issuedAtMs = issuedAt ? Date.parse(issuedAt) : NaN;
  const message = typeof parsed.message === "string" ? parsed.message : null;
  const signature = typeof parsed.signature === "string" && parsed.signature.startsWith("0x") ? parsed.signature : null;
  const walletId = typeof parsed.walletId === "string" ? parsed.walletId : null;
  const mode = isExternalMode(parsed.mode) ? parsed.mode : null;
  const valid =
    parsed.version === "1" &&
    parsedAddress !== null &&
    parsed.chainId === chainConfig.id &&
    domain === currentSiweDomain() &&
    uri === currentSiweUri() &&
    message !== null &&
    signature !== null &&
    nonce !== null &&
    issuedAt !== null &&
    Number.isFinite(issuedAtMs) &&
    walletId !== null &&
    mode !== null;

  if (!valid) {
    return null;
  }

  return {
    version: "1",
    address: parsedAddress,
    chainId: chainConfig.id,
    domain,
    uri,
    nonce,
    issuedAt,
    walletId,
    mode,
    message,
    signature: signature as HexString
  };
};

const loadSiweSession = (address: HexString, walletId: string, mode: WalletMode): SiweSession | null => {
  if (!hasStorage() || mode === "local") {
    return null;
  }

  const parsed = parseStoredSiweSession();
  if (!parsed) {
    return null;
  }

  if (parsed.address !== address || parsed.walletId !== walletId || parsed.mode !== mode) {
    appLog.info("siwe: stored proof did not match current thirdweb wallet session", {
      walletId,
      mode,
      address: shortHash(address, 10, 6)
    });
    return null;
  }

  appLog.info("siwe: restored persisted proof", {
    walletId,
    mode,
    address: shortHash(address, 10, 6),
    issuedAt: parsed.issuedAt
  });
  return parsed;
};

const saveSiweSession = (siweSession: SiweSession): void => {
  if (!hasStorage()) {
    return;
  }
  window.localStorage.setItem(SIWE_SESSION_KEY, JSON.stringify(siweSession));
};

const clearSiweSession = (): void => {
  if (!hasStorage()) {
    return;
  }
  window.localStorage.removeItem(SIWE_SESSION_KEY);
};

const parseStoredWalletSession = (parsed: Partial<PersistedWalletSession> | null): PersistedWalletSession | null => {
  if (!parsed) {
    return null;
  }

  const address =
    typeof parsed.address === "string" && parsed.address.startsWith("0x")
      ? normalizeAddress(parsed.address)
      : null;
  const walletId = typeof parsed.walletId === "string" ? parsed.walletId : null;
  const connectedAt = typeof parsed.connectedAt === "string" ? parsed.connectedAt : null;
  const lastSeenAt = typeof parsed.lastSeenAt === "string" ? parsed.lastSeenAt : null;
  const domain = typeof parsed.domain === "string" ? parsed.domain : null;
  const uri = typeof parsed.uri === "string" ? parsed.uri : null;
  const mode = isExternalMode(parsed.mode) ? parsed.mode : null;
  const valid =
    parsed.version === "1" &&
    address !== null &&
    parsed.chainId === chainConfig.id &&
    connectedAt !== null &&
    Number.isFinite(Date.parse(connectedAt)) &&
    lastSeenAt !== null &&
    Number.isFinite(Date.parse(lastSeenAt)) &&
    domain === currentSiweDomain() &&
    uri === currentSiweUri() &&
    mode !== null &&
    walletId !== null;

  if (!valid) {
    return null;
  }

  return {
    version: "1",
    address,
    chainId: chainConfig.id,
    connectedAt,
    domain,
    lastSeenAt,
    mode,
    uri,
    walletId
  };
};

const loadWalletSession = (): PersistedWalletSession | null => {
  if (!hasStorage()) {
    return null;
  }

  const walletSession = parseStoredWalletSession(
    readStoredJson<Partial<PersistedWalletSession>>(WALLET_SESSION_KEY, "wallet-session")
  );
  if (walletSession) {
    appLog.info("auth: loaded persisted wallet session", {
      walletId: walletSession.walletId,
      address: shortHash(walletSession.address, 10, 6),
      lastSeenAt: walletSession.lastSeenAt
    });
    return walletSession;
  }

  const siweSession = parseStoredSiweSession();
  if (!siweSession) {
    return null;
  }

  appLog.info("auth: deriving wallet reconnect hint from persisted SIWE proof", {
    walletId: siweSession.walletId,
    address: shortHash(siweSession.address, 10, 6),
    issuedAt: siweSession.issuedAt
  });
  return {
    version: "1",
    address: siweSession.address,
    chainId: chainConfig.id,
    connectedAt: siweSession.issuedAt,
    domain: siweSession.domain,
    lastSeenAt: siweSession.issuedAt,
    mode: siweSession.mode,
    uri: siweSession.uri,
    walletId: siweSession.walletId
  };
};

const saveThirdwebReconnectHints = (walletId: string): void => {
  if (!hasStorage()) {
    return;
  }

  window.localStorage.setItem(THIRDWEB_CONNECTED_WALLET_IDS_KEY, JSON.stringify([walletId]));
  window.localStorage.setItem(THIRDWEB_ACTIVE_WALLET_ID_KEY, walletId);
  window.localStorage.setItem(THIRDWEB_LAST_USED_WALLET_ID_KEY, walletId);
  window.localStorage.setItem(THIRDWEB_ACTIVE_CHAIN_KEY, JSON.stringify(appChain));
};

const clearThirdwebReconnectHints = (): void => {
  if (!hasStorage()) {
    return;
  }

  window.localStorage.removeItem(THIRDWEB_CONNECTED_WALLET_IDS_KEY);
  window.localStorage.removeItem(THIRDWEB_ACTIVE_WALLET_ID_KEY);
  window.localStorage.removeItem(THIRDWEB_LAST_USED_WALLET_ID_KEY);
  window.localStorage.removeItem(THIRDWEB_ACTIVE_CHAIN_KEY);
};

const saveWalletSession = (
  walletId: string,
  address: HexString,
  mode: ExternalWalletMode,
  connectedAtOverride?: string
): void => {
  if (!hasStorage()) {
    return;
  }

  const existing = parseStoredWalletSession(
    readStoredJson<Partial<PersistedWalletSession>>(WALLET_SESSION_KEY, "wallet-session")
  );
  const now = new Date().toISOString();
  const connectedAt =
    connectedAtOverride ??
    (existing?.walletId === walletId && existing.address === address && existing.mode === mode
      ? existing.connectedAt
      : now);
  const walletSession: PersistedWalletSession = {
    version: "1",
    address,
    chainId: chainConfig.id,
    connectedAt,
    domain: currentSiweDomain(),
    lastSeenAt: now,
    mode,
    uri: currentSiweUri(),
    walletId
  };
  window.localStorage.setItem(WALLET_SESSION_KEY, JSON.stringify(walletSession));
  saveThirdwebReconnectHints(walletId);
  appLog.info("auth: persisted wallet session", {
    walletId,
    mode,
    address: shortHash(address, 10, 6),
    connectedAt,
    lastSeenAt: now
  });
};

const clearWalletSession = (): void => {
  if (!hasStorage()) {
    return;
  }

  window.localStorage.removeItem(WALLET_SESSION_KEY);
  clearThirdwebReconnectHints();
};

const walletLabel = (walletId: string): string => {
  if (walletId === "walletConnect") {
    return "WalletConnect QR";
  }
  if (walletId === "local-xmtp") {
    return "Local XMTP wallet";
  }
  return walletId;
};

export class ThirdwebAuthController {
  readonly client = thirdwebClient;
  private session: SessionState = defaultSessionState();
  private listeners = new Set<SessionListener>();
  private activeWallet: Wallet | null = null;
  private localIdentity: LocalXmtpIdentity | null = loadLocalXmtpIdentity();
  private ensLookupToken = 0;

  isConfigured(): boolean {
    return Boolean(thirdwebClient);
  }

  requireClient() {
    return requireThirdwebClient();
  }

  getSession(): SessionState {
    return this.session;
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    listener(this.session);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener(this.session));
  }

  private nextEnsState(address: HexString | null) {
    return emptyEnsProfile(address ? "loading" : "idle");
  }

  private async hydrateEnsProfile(address: HexString, options: { refresh?: boolean } = {}): Promise<void> {
    const lookupToken = ++this.ensLookupToken;
    const profile = await resolveEnsProfile(address, options);

    if (lookupToken !== this.ensLookupToken || this.session.address !== address) {
      return;
    }

    this.session = {
      ...this.session,
      ...profile
    };
    this.emit();
  }

  async refreshEnsProfile(): Promise<void> {
    const address = this.session.address;
    if (!address) {
      throw new Error("Connect a wallet before refreshing ENS.");
    }

    appLog.info("ens: manual profile refresh requested", { address: shortHash(address, 10, 6) });
    const lookupToken = ++this.ensLookupToken;
    this.session = {
      ...this.session,
      ...emptyEnsProfile("loading")
    };
    this.emit();

    const profile = await refreshEnsProfileFromNetwork(address);
    if (lookupToken !== this.ensLookupToken || this.session.address !== address) {
      return;
    }

    this.session = {
      ...this.session,
      ...profile
    };
    this.emit();
    if (profile.ensLookupStatus === "error") {
      throw new Error("ENS lookup is unavailable right now.");
    }
  }

  private setLoading(): void {
    appLog.info("auth: session loading");
    this.session = {
      ...this.session,
      status: "loading",
      lastError: null
    };
    this.emit();
  }

  private setError(message: string): void {
    appLog.error("auth: session error", { message });
    this.ensLookupToken += 1;
    this.session = {
      ...defaultSessionState(),
      status: "error",
      lastError: message
    };
    this.emit();
  }

  private async resetActiveWallet(): Promise<void> {
    try {
      await this.activeWallet?.disconnect();
    } catch (error) {
      appLog.warn("thirdweb: disconnect during reset was ignored", error);
    }
    this.ensLookupToken += 1;
    this.activeWallet = null;
    this.localIdentity = null;
    clearSiweSession();
    clearWalletSession();
  }

  private walletForId(walletId: string): Wallet {
    if (walletId === "walletConnect") {
      return wcWallet;
    }
    return getInstalledWallets().find((entry) => entry.id === walletId) ?? createWallet(walletId as never);
  }

  private async setWallet(wallet: Wallet, mode: ExternalWalletMode): Promise<void> {
    this.activeWallet = wallet;
    this.localIdentity = null;
    const account = wallet.getAccount();
    const address = account ? normalizeAddress(account.address) : null;
    const siweSession = address ? loadSiweSession(address, wallet.id, mode) : null;

    appLog.info("thirdweb: wallet session connected", {
      walletId: wallet.id,
      mode,
      address: address ? shortHash(address, 10, 6) : null,
      siwe: siweSession ? "restored" : "missing"
    });

    this.session = {
      status: account ? "connected" : "idle",
      walletId: wallet.id,
      address,
      mode,
      ...this.nextEnsState(address),
      ...siweFields(siweSession),
      isReviewer: isTrustedReviewer(address),
      lastError: null
    };

    if (address) {
      saveWalletSession(wallet.id, address, mode);
    }
    this.watchWallet(wallet, mode);
    this.emit();

    if (address) {
      void this.hydrateEnsProfile(address);
    }
  }

  private setLocalIdentity(identity: LocalXmtpIdentity): void {
    appLog.info("local-xmtp: activating stored browser identity", { address: shortHash(identity.address, 10, 6) });
    this.activeWallet = null;
    this.localIdentity = identity;
    clearSiweSession();
    clearWalletSession();
    this.session = {
      status: "connected",
      walletId: "local-xmtp",
      address: identity.address,
      mode: "local",
      ...this.nextEnsState(identity.address),
      ...siweFields(null),
      isReviewer: isTrustedReviewer(identity.address),
      lastError: null
    };
    this.emit();
    void this.hydrateEnsProfile(identity.address);
  }

  private watchWallet(wallet: Wallet, mode: ExternalWalletMode): void {
    appLog.info("thirdweb: installing wallet listeners", { walletId: wallet.id, mode });
    wallet.subscribe("accountChanged", async (account) => {
      const address = account ? normalizeAddress(account.address) : null;
      const siweSession = address ? loadSiweSession(address, wallet.id, mode) : null;
      appLog.info("thirdweb: accountChanged event", {
        walletId: wallet.id,
        mode,
        address: address ? shortHash(address, 10, 6) : null
      });
      this.session = {
        ...this.session,
        address,
        mode,
        ...this.nextEnsState(address),
        ...siweFields(siweSession),
        isReviewer: isTrustedReviewer(address)
      };
      this.emit();

      if (address) {
        void this.hydrateEnsProfile(address);
      } else {
        this.ensLookupToken += 1;
        clearWalletSession();
      }

      if (address) {
        if (!siweSession) {
          clearSiweSession();
        }
        saveWalletSession(wallet.id, address, mode);
      }
    });

    wallet.subscribe("disconnect", () => {
      appLog.warn("thirdweb: wallet disconnect event", { walletId: wallet.id, mode });
      this.ensLookupToken += 1;
      this.activeWallet = null;
      clearSiweSession();
      clearWalletSession();
      this.session = defaultSessionState();
      this.emit();
    });
  }

  private async signInWithEthereum(): Promise<void> {
    if (!this.session.address || !this.session.walletId || !this.session.mode) {
      throw new Error("Connect a wallet before signing in.");
    }
    if (this.session.mode === "local") {
      throw new Error("Local XMTP identities do not use SIWE login.");
    }

    const account = this.activeWallet?.getAccount() as SignableThirdwebAccount | undefined;
    if (!account?.signMessage) {
      throw new Error("The connected wallet cannot sign login messages.");
    }

    const address = this.session.address;
    const walletId = this.session.walletId;
    const mode = this.session.mode;
    const issuedAt = new Date().toISOString();
    const unsignedSession = {
      address,
      chainId: chainConfig.id,
      domain: currentSiweDomain(),
      uri: currentSiweUri(),
      nonce: createNonce(),
      issuedAt,
      walletId,
      mode
    } satisfies Omit<SiweSession, "version" | "message" | "signature">;
    const message = buildSiweMessage(unsignedSession);

    appLog.info("siwe: requesting thirdweb wallet signature", {
      walletId,
      mode,
      address: shortHash(address, 10, 6),
      domain: unsignedSession.domain,
      chainId: chainConfig.id
    });
    const signature = toHexString(await account.signMessage({ message }), "SIWE signature");
    const recoveredAddress = normalizeAddress(verifyMessage(message, signature));
    if (recoveredAddress !== address) {
      appLog.error("siwe: signature recovered the wrong address", {
        expected: shortHash(address, 10, 6),
        recovered: shortHash(recoveredAddress, 10, 6)
      });
      throw new Error("SIWE signature did not match the connected wallet.");
    }

    const siweSession: SiweSession = {
      version: "1",
      ...unsignedSession,
      message,
      signature
    };
    saveSiweSession(siweSession);
    saveWalletSession(walletId, address, mode, this.session.siweIssuedAt ?? undefined);
    this.session = {
      ...this.session,
      ...siweFields(siweSession),
      lastError: null
    };
    this.emit();
    appLog.info("siwe: signature saved", {
      walletId,
      mode,
      address: shortHash(address, 10, 6),
      issuedAt,
      signatureBytes: Math.max(0, (signature.length - 2) / 2)
    });
  }

  async initialize(): Promise<void> {
    appLog.info("auth: initializing thirdweb wallet session");
    if (!thirdwebClient) {
      const localIdentity = loadLocalXmtpIdentity();
      if (localIdentity) {
        this.setLocalIdentity(localIdentity);
        return;
      }
      this.setError(thirdwebDisabledMessage);
      return;
    }

    this.setLoading();
    try {
      const wallets = [wcWallet, ...getInstalledWallets()];
      await autoConnect({
        client: requireThirdwebClient(),
        chain: appChain,
        wallets,
        appMetadata: APP_METADATA,
        onConnect: async (wallet) => {
          await this.setWallet(wallet, "external");
        }
      });

      if (!this.activeWallet) {
        const restoredPersistedWallet = await this.restorePersistedWalletSession();
        if (restoredPersistedWallet) {
          return;
        }

        const localIdentity = loadLocalXmtpIdentity();
        if (localIdentity) {
          this.setLocalIdentity(localIdentity);
        } else {
          appLog.info("auth: no thirdweb session restored");
          this.session = defaultSessionState();
          this.emit();
        }
      } else {
        appLog.info("auth: thirdweb wallet session restored", { walletId: this.activeWallet.id });
      }
    } catch (error) {
      appLog.warn("auth: thirdweb auto-connect failed", error);
      const localIdentity = loadLocalXmtpIdentity();
      if (localIdentity) {
        this.setLocalIdentity(localIdentity);
        return;
      }
      this.setError(error instanceof Error ? error.message : "Auto-connect failed.");
    }
  }

  private async restorePersistedWalletSession(): Promise<boolean> {
    const persistedSession = loadWalletSession();
    if (!persistedSession) {
      appLog.info("auth: no persisted wallet session available for reconnect");
      return false;
    }

    const wallet = this.walletForId(persistedSession.walletId);
    appLog.info("auth: attempting persisted thirdweb wallet reconnect", {
      walletId: wallet.id,
      address: shortHash(persistedSession.address, 10, 6),
      lastSeenAt: persistedSession.lastSeenAt
    });

    try {
      saveThirdwebReconnectHints(wallet.id);
      await wallet.autoConnect({
        client: requireThirdwebClient(),
        chain: appChain
      });

      const account = wallet.getAccount();
      if (!account) {
        throw new Error("Persisted wallet reconnect did not return an account.");
      }

      const reconnectedAddress = normalizeAddress(account.address);
      if (reconnectedAddress !== persistedSession.address) {
        appLog.warn("auth: persisted wallet reconnected with a different account", {
          walletId: wallet.id,
          expected: shortHash(persistedSession.address, 10, 6),
          actual: shortHash(reconnectedAddress, 10, 6)
        });
        clearSiweSession();
      }

      await this.setWallet(wallet, persistedSession.mode);
      appLog.info("auth: persisted wallet session restored", {
        walletId: wallet.id,
        address: shortHash(reconnectedAddress, 10, 6)
      });
      return true;
    } catch (error) {
      appLog.warn("auth: persisted thirdweb wallet reconnect failed", {
        walletId: wallet.id,
        address: shortHash(persistedSession.address, 10, 6),
        error
      });
      return false;
    }
  }

  listExternalWallets(): Array<{ id: string; label: string }> {
    if (!thirdwebClient) {
      return [];
    }

    const installed = getInstalledWallets().map((wallet) => ({
      id: wallet.id,
      label: walletLabel(wallet.id)
    }));

    return [
      ...installed,
      {
        id: "walletConnect",
        label: "WalletConnect QR"
      }
    ];
  }

  async connectPrimary(): Promise<void> {
    appLog.info("auth: primary thirdweb login requested", {
      installedWallets: getInstalledWallets().map((wallet) => wallet.id),
      thirdwebConfigured: Boolean(thirdwebClient)
    });

    const installed = getInstalledWallets();
    if (installed[0]) {
      try {
        await this.connectExternal(installed[0].id);
        return;
      } catch (error) {
        appLog.warn("auth: installed wallet login failed, falling back to Thirdweb WalletConnect", error);
      }
    }

    await this.connectExternal("walletConnect");
  }

  async connectExternal(walletId: string): Promise<void> {
    if (!thirdwebClient) {
      this.setError(thirdwebDisabledMessage);
      throw new Error(thirdwebDisabledMessage);
    }

    appLog.info("auth: thirdweb external wallet login requested", { walletId });
    const wallet = this.walletForId(walletId);

    this.setLoading();
    try {
      if (wallet.id === "walletConnect") {
        appLog.info("thirdweb: opening WalletConnect QR", { walletId: wallet.id, chainId: chainConfig.id });
        await wallet.connect({
          client: requireThirdwebClient(),
          chain: appChain,
          walletConnect: {
            showQrModal: true,
            appMetadata: APP_METADATA
          }
        });
      } else {
        appLog.info("thirdweb: connecting installed wallet", { walletId: wallet.id, chainId: chainConfig.id });
        await wallet.connect({
          client: requireThirdwebClient(),
          chain: appChain
        });
      }

      await this.setWallet(wallet, "external");
      await this.signInWithEthereum();
      appLog.info("auth: thirdweb wallet login completed", {
        walletId: wallet.id,
        address: this.session.address ? shortHash(this.session.address, 10, 6) : null,
        siweIssuedAt: this.session.siweIssuedAt
      });
    } catch (error) {
      appLog.error("auth: thirdweb wallet login failed", { walletId, error });
      await this.resetActiveWallet();
      this.setError(error instanceof Error ? error.message : "Wallet connection failed.");
      throw error;
    }
  }

  getActiveAccount() {
    return this.activeWallet?.getAccount();
  }

  getActiveWallet() {
    return this.activeWallet;
  }

  hasLocalIdentity(): boolean {
    return Boolean(loadLocalXmtpIdentity());
  }

  getLocalIdentity(): LocalXmtpIdentity | null {
    return this.localIdentity ?? loadLocalXmtpIdentity();
  }

  async createLocalIdentity(): Promise<LocalXmtpIdentity> {
    appLog.info("local-xmtp: create identity requested");
    if (loadLocalXmtpIdentity()) {
      appLog.warn("local-xmtp: create blocked because identity already exists");
      throw new Error("A local XMTP wallet already exists in this browser. Use it or forget it before creating a new one.");
    }
    const identity = createLocalXmtpIdentity();
    this.setLocalIdentity(identity);
    appLog.info("local-xmtp: identity created", { address: shortHash(identity.address, 10, 6) });
    return identity;
  }

  async useLocalIdentity(): Promise<LocalXmtpIdentity> {
    appLog.info("local-xmtp: use stored identity requested");
    const identity = loadLocalXmtpIdentity() ?? createLocalXmtpIdentity();
    saveLocalXmtpIdentity(identity);
    this.setLocalIdentity(identity);
    appLog.info("local-xmtp: identity active", { address: shortHash(identity.address, 10, 6) });
    return identity;
  }

  forgetLocalIdentity(): void {
    appLog.warn("local-xmtp: forgetting stored identity at user request");
    clearLocalXmtpIdentity();
    if (this.session.mode === "local") {
      this.ensLookupToken += 1;
      this.localIdentity = null;
      this.session = defaultSessionState();
      this.emit();
    }
  }

  async getSigner(): Promise<Signer> {
    if (this.session.mode === "local") {
      appLog.info("wallet: resolving signer from local XMTP wallet");
      const identity = this.getLocalIdentity();
      if (!identity) {
        throw new Error("Stored local XMTP wallet is missing.");
      }
      return new EthersWallet(identity.privateKey, BASE_RPC_PROVIDER);
    }

    const account = this.activeWallet?.getAccount();
    if (!account) {
      appLog.warn("wallet: signer requested before thirdweb wallet connection");
      throw new Error("Connect a wallet first.");
    }

    appLog.info("wallet: resolving signer from thirdweb active account", {
      walletId: this.activeWallet?.id,
      address: shortHash(account.address, 10, 6)
    });
    return ethers6Adapter.signer.toEthers({
      client: requireThirdwebClient(),
      chain: appChain,
      account
    });
  }

  getXmtpIdentity(): BrowserXmtpIdentity | null {
    if (this.localIdentity && this.session.address === this.localIdentity.address) {
      return {
        address: this.localIdentity.address,
        privateKey: this.localIdentity.privateKey
      };
    }

    const account = this.activeWallet?.getAccount() as SignableThirdwebAccount | undefined;
    const address = account ? normalizeAddress(account.address) : null;
    if (!address || !account?.signMessage) {
      return null;
    }
    const chainId = this.activeWallet?.getChain()?.id ?? chainConfig.id;

    return {
      address,
      signMessage: async (message: string) =>
        account.signMessage?.({ message, chainId }) ?? Promise.reject(new Error("Wallet cannot sign."))
    };
  }

  async disconnect(): Promise<void> {
    appLog.info("auth: disconnect requested", {
      walletId: this.session.walletId,
      mode: this.session.mode,
      address: this.session.address ? shortHash(this.session.address, 10, 6) : null
    });
    try {
      await this.activeWallet?.disconnect();
    } catch (error) {
      appLog.warn("thirdweb: disconnect was ignored", error);
    }
    this.ensLookupToken += 1;
    this.activeWallet = null;
    this.localIdentity = null;
    clearSiweSession();
    clearWalletSession();
    this.session = defaultSessionState();
    this.emit();
    appLog.info("auth: disconnected");
  }

  walletLabel(walletId: string | null): string {
    return walletId ? walletLabel(walletId) : "-";
  }
}
