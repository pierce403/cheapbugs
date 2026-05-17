import { JsonRpcProvider, Wallet as EthersWallet, verifyMessage, type Signer } from "ethers";
import { createThirdwebClient } from "thirdweb";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";
import { autoConnect, createWallet, getInstalledWallets, walletConnect, type Wallet } from "thirdweb/wallets";

import { appChain, chainConfig } from "../config/chains";
import { env } from "../config/env";
import { isTrustedReviewer } from "../config/reviewers";
import { APP_METADATA } from "../lib/constants";
import { emptyEnsProfile, resolveEnsProfile } from "../lib/ens";
import { appLog } from "../lib/logger";
import { normalizeAddress, shortHash } from "../lib/utils";
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
type SignableThirdwebAccount = {
  address: string;
  signMessage?: (args: { message: string }) => Promise<string>;
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

const SIWE_SESSION_KEY = "cheapbugs.siweSession.v1";
const BASE_RPC_PROVIDER = new JsonRpcProvider(chainConfig.rpcUrl, chainConfig.id);
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

const loadSiweSession = (address: HexString, walletId: string, mode: WalletMode): SiweSession | null => {
  if (!hasStorage() || mode === "local") {
    return null;
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(SIWE_SESSION_KEY) || "null") as Partial<SiweSession> | null;
    if (!parsed) {
      return null;
    }

    const parsedAddress = parsed.address ? normalizeAddress(parsed.address) : null;
    const domain = typeof parsed.domain === "string" ? parsed.domain : null;
    const uri = typeof parsed.uri === "string" ? parsed.uri : null;
    const nonce = typeof parsed.nonce === "string" ? parsed.nonce : null;
    const issuedAt = typeof parsed.issuedAt === "string" ? parsed.issuedAt : null;
    const issuedAtMs = issuedAt ? Date.parse(issuedAt) : NaN;
    const message = typeof parsed.message === "string" ? parsed.message : null;
    const signature =
      typeof parsed.signature === "string" && parsed.signature.startsWith("0x") ? parsed.signature : null;
    const valid =
      parsed.version === "1" &&
      parsedAddress === address &&
      parsed.chainId === chainConfig.id &&
      domain === currentSiweDomain() &&
      uri === currentSiweUri() &&
      parsed.walletId === walletId &&
      parsed.mode === mode &&
      message !== null &&
      signature !== null &&
      nonce !== null &&
      issuedAt !== null &&
      Number.isFinite(issuedAtMs);

    if (!valid) {
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
      issuedAt
    });
    return {
      version: "1",
      address,
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
  } catch (error) {
    appLog.warn("siwe: failed to parse persisted proof", error);
    return null;
  }
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

  private async hydrateEnsProfile(address: HexString): Promise<void> {
    const lookupToken = ++this.ensLookupToken;
    const profile = await resolveEnsProfile(address);

    if (lookupToken !== this.ensLookupToken || this.session.address !== address) {
      return;
    }

    this.session = {
      ...this.session,
      ...profile
    };
    this.emit();
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
  }

  private async setWallet(wallet: Wallet, mode: Exclude<WalletMode, "local">): Promise<void> {
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

  private watchWallet(wallet: Wallet, mode: Exclude<WalletMode, "local">): void {
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
      }
    });

    wallet.subscribe("disconnect", () => {
      appLog.warn("thirdweb: wallet disconnect event", { walletId: wallet.id, mode });
      this.ensLookupToken += 1;
      this.activeWallet = null;
      clearSiweSession();
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
    const wallet =
      walletId === "walletConnect"
        ? wcWallet
        : getInstalledWallets().find((entry) => entry.id === walletId) ?? createWallet(walletId as never);

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

    return {
      address,
      signMessage: async (message: string) => account.signMessage?.({ message }) ?? Promise.reject(new Error("Wallet cannot sign."))
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
    this.session = defaultSessionState();
    this.emit();
    appLog.info("auth: disconnected");
  }

  walletLabel(walletId: string | null): string {
    return walletId ? walletLabel(walletId) : "-";
  }
}
