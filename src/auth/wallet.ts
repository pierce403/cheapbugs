import EthereumProvider from "@walletconnect/ethereum-provider";
import { BrowserProvider, JsonRpcProvider, Wallet, verifyMessage, type Eip1193Provider, type Signer } from "ethers";

import { chainConfig } from "../config/chains";
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
type WalletProvider = Eip1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  disconnect?: () => Promise<void>;
};
type InjectedWalletProvider = WalletProvider & {
  providers?: InjectedWalletProvider[];
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isRabby?: boolean;
};

type PersistedSession = {
  mode: WalletMode;
  walletId: string;
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

const AUTH_SESSION_KEY = "cheapbugs.walletSession.v1";
const SIWE_SESSION_KEY = "cheapbugs.siweSession.v1";
const BASE_RPC_PROVIDER = new JsonRpcProvider(chainConfig.rpcUrl, chainConfig.id);

declare global {
  interface Window {
    ethereum?: InjectedWalletProvider;
  }
}

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

const loadPersistedSession = (): PersistedSession | null => {
  if (!hasStorage()) {
    return null;
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(AUTH_SESSION_KEY) || "null") as Partial<PersistedSession> | null;
    if (!parsed?.mode || !parsed.walletId) {
      return null;
    }
    if (!["injected", "walletconnect", "local"].includes(parsed.mode)) {
      return null;
    }
    return {
      mode: parsed.mode as WalletMode,
      walletId: parsed.walletId
    };
  } catch {
    return null;
  }
};

const savePersistedSession = (session: PersistedSession): void => {
  if (!hasStorage()) {
    return;
  }
  window.localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
};

const clearPersistedSession = (): void => {
  if (!hasStorage()) {
    return;
  }
  window.localStorage.removeItem(AUTH_SESSION_KEY);
};

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
      appLog.info("siwe: stored proof did not match current wallet/session", {
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

const chainIdHex = (): `0x${string}` => `0x${chainConfig.id.toString(16)}`;

const walletLabel = (walletId: string): string => {
  if (walletId === "browser") {
    return "Browser wallet";
  }
  if (walletId === "walletconnect") {
    return "WalletConnect QR";
  }
  if (walletId === "local-xmtp") {
    return "Local XMTP wallet";
  }
  return walletId;
};

const installedProvider = (): WalletProvider | null => {
  if (typeof window === "undefined" || !window.ethereum) {
    return null;
  }
  const providers = window.ethereum.providers;
  return providers?.find((provider) => provider.isMetaMask) ?? providers?.[0] ?? window.ethereum;
};

const chainParams = () => ({
  chainId: chainIdHex(),
  chainName: chainConfig.name,
  nativeCurrency: {
    name: chainConfig.nativeSymbol,
    symbol: chainConfig.nativeSymbol,
    decimals: 18
  },
  rpcUrls: [chainConfig.rpcUrl],
  blockExplorerUrls: [chainConfig.explorerUrl]
});

const requestBaseChain = async (provider: WalletProvider): Promise<void> => {
  appLog.info("wallet: requesting Base chain", { chainId: chainConfig.id, chainIdHex: chainIdHex() });
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex() }]
    });
    appLog.info("wallet: Base chain selected", { chainId: chainConfig.id });
  } catch (error) {
    const code = (error as { code?: number | string })?.code;
    if (code !== 4902 && code !== "4902") {
      appLog.error("wallet: failed to switch to Base", error);
      throw error;
    }
    appLog.info("wallet: Base chain missing in wallet, requesting addEthereumChain", { chainId: chainConfig.id });
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [chainParams()]
    });
    appLog.info("wallet: Base chain added", { chainId: chainConfig.id });
  }
};

const getInjectedAccounts = async (provider: WalletProvider): Promise<`0x${string}`[]> => {
  const accounts = (await provider.request({ method: "eth_accounts" })) as string[] | undefined;
  return (accounts ?? []).map((account) => normalizeAddress(account));
};

export class WalletAuthController {
  private session: SessionState = defaultSessionState();
  private listeners = new Set<SessionListener>();
  private activeProvider: WalletProvider | null = null;
  private activeWalletConnect: EthereumProvider | null = null;
  private localIdentity: LocalXmtpIdentity | null = loadLocalXmtpIdentity();
  private ensLookupToken = 0;
  private teardownProviderListeners: (() => void) | null = null;

  isConfigured(): boolean {
    return Boolean(installedProvider() || env.walletConnectProjectId);
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

  private nextEnsState(address: `0x${string}` | null) {
    return emptyEnsProfile(address ? "loading" : "idle");
  }

  private async hydrateEnsProfile(address: `0x${string}`): Promise<void> {
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

  private async resetConnection(): Promise<void> {
    this.teardownProviderListeners?.();
    this.teardownProviderListeners = null;
    try {
      await this.activeWalletConnect?.disconnect();
    } catch (error) {
      appLog.warn("walletconnect: disconnect during reset was ignored", error);
    }
    this.ensLookupToken += 1;
    this.activeProvider = null;
    this.activeWalletConnect = null;
    this.localIdentity = null;
    clearPersistedSession();
    clearSiweSession();
  }

  private setConnected(
    address: `0x${string}`,
    walletId: string,
    mode: WalletMode,
    provider: WalletProvider | null
  ): void {
    const siweSession = loadSiweSession(address, walletId, mode);
    appLog.info("auth: connected wallet session", {
      walletId,
      mode,
      address: shortHash(address, 10, 6),
      siwe: siweSession ? "restored" : mode === "local" ? "not-required" : "missing"
    });
    this.activeProvider = provider;
    this.localIdentity = mode === "local" ? this.localIdentity : null;
    this.session = {
      status: "connected",
      walletId,
      address,
      mode,
      ...this.nextEnsState(address),
      ...siweFields(siweSession),
      isReviewer: isTrustedReviewer(address),
      lastError: null
    };
    savePersistedSession({ mode, walletId });
    this.emit();
    void this.hydrateEnsProfile(address);
  }

  private watchProvider(provider: WalletProvider, mode: WalletMode, walletId: string): void {
    this.teardownProviderListeners?.();
    const onAccountsChanged = (payload: unknown) => {
      appLog.info("wallet: accountsChanged event", { walletId, mode, payload });
      const accounts = Array.isArray(payload) ? payload : [];
      const address = accounts[0] ? normalizeAddress(String(accounts[0])) : null;
      if (!address) {
        appLog.warn("wallet: accountsChanged cleared active account", { walletId, mode });
        void this.disconnect();
        return;
      }
      this.setConnected(address, walletId, mode, provider);
    };
    const onDisconnect = () => {
      appLog.warn("wallet: provider disconnect event", { walletId, mode });
      void this.disconnect();
    };

    appLog.info("wallet: installing provider listeners", { walletId, mode });
    provider.on?.("accountsChanged", onAccountsChanged);
    provider.on?.("disconnect", onDisconnect);
    this.teardownProviderListeners = () => {
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("disconnect", onDisconnect);
    };
  }

  private setLocalIdentity(identity: LocalXmtpIdentity): void {
    appLog.info("local-xmtp: activating stored browser identity", { address: shortHash(identity.address, 10, 6) });
    this.teardownProviderListeners?.();
    this.teardownProviderListeners = null;
    this.activeProvider = null;
    this.activeWalletConnect = null;
    this.localIdentity = identity;
    this.setConnected(identity.address, "local-xmtp", "local", null);
  }

  private async connectInjected({ requestAccounts }: { requestAccounts: boolean }): Promise<void> {
    appLog.info("browser-wallet: starting injected wallet connection", { requestAccounts });
    const provider = installedProvider();
    if (!provider) {
      appLog.warn("browser-wallet: no injected provider found");
      throw new Error("No browser wallet was found. Use WalletConnect QR or install a web3 wallet extension.");
    }

    const accounts = requestAccounts
      ? ((await provider.request({ method: "eth_requestAccounts" })) as string[] | undefined) ?? []
      : await getInjectedAccounts(provider);
    const address = accounts[0] ? normalizeAddress(String(accounts[0])) : null;
    if (!address) {
      appLog.warn("browser-wallet: provider returned no active account", { requestAccounts });
      throw new Error("Browser wallet is not connected to this site.");
    }
    appLog.info("browser-wallet: account selected", { address: shortHash(address, 10, 6) });
    await requestBaseChain(provider);

    this.activeWalletConnect = null;
    this.watchProvider(provider, "injected", "browser");
    this.setConnected(address, "browser", "injected", provider);
  }

  private async initWalletConnect(showQrModal: boolean): Promise<EthereumProvider> {
    if (!env.walletConnectProjectId) {
      appLog.warn("walletconnect: project id missing, QR login unavailable");
      throw new Error("Set VITE_WALLETCONNECT_PROJECT_ID to enable WalletConnect QR login.");
    }

    appLog.info("walletconnect: initializing provider", { showQrModal, chainId: chainConfig.id });
    return EthereumProvider.init({
      projectId: env.walletConnectProjectId,
      chains: [chainConfig.id],
      optionalChains: [chainConfig.id],
      rpcMap: {
        [chainConfig.id]: chainConfig.rpcUrl
      },
      showQrModal,
      metadata: {
        name: APP_METADATA.name,
        description: APP_METADATA.description,
        url: APP_METADATA.url,
        icons: APP_METADATA.logoUrl ? [APP_METADATA.logoUrl] : []
      },
      methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData", "eth_signTypedData_v4"],
      events: ["accountsChanged", "chainChanged", "disconnect"]
    });
  }

  private async connectWalletConnect({ showQrModal }: { showQrModal: boolean }): Promise<void> {
    const provider = await this.initWalletConnect(showQrModal);
    if (!provider.connected) {
      appLog.info("walletconnect: opening connection", { showQrModal, chainId: chainConfig.id });
      await provider.connect({
        chains: [chainConfig.id],
        optionalChains: [chainConfig.id]
      });
    } else {
      appLog.info("walletconnect: reusing persisted provider session", { chainId: chainConfig.id });
    }

    const accounts = ((await provider.request({ method: "eth_accounts" })) as string[] | undefined) ?? provider.accounts;
    const address = accounts[0] ? normalizeAddress(String(accounts[0])) : null;
    if (!address) {
      appLog.warn("walletconnect: connected session had no account");
      throw new Error("WalletConnect connected without an account.");
    }
    appLog.info("walletconnect: account selected", { address: shortHash(address, 10, 6) });

    this.activeWalletConnect = provider;
    this.watchProvider(provider as WalletProvider, "walletconnect", "walletconnect");
    this.setConnected(address, "walletconnect", "walletconnect", provider as WalletProvider);
  }

  private async signInWithEthereum(): Promise<void> {
    if (!this.session.address || !this.session.walletId || !this.session.mode) {
      throw new Error("Connect a wallet before signing in.");
    }
    if (this.session.mode === "local") {
      throw new Error("Local XMTP identities do not use SIWE login.");
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

    appLog.info("siwe: requesting wallet signature", {
      walletId: this.session.walletId,
      mode: this.session.mode,
      address: shortHash(this.session.address, 10, 6),
      domain: unsignedSession.domain,
      chainId: chainConfig.id
    });
    const signer = await this.getSigner();
    const signature = toHexString(await signer.signMessage(message), "SIWE signature");
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
      walletId: siweSession.walletId,
      mode: siweSession.mode,
      address: shortHash(siweSession.address, 10, 6),
      issuedAt: siweSession.issuedAt,
      signatureBytes: Math.max(0, (siweSession.signature.length - 2) / 2)
    });
  }

  async initialize(): Promise<void> {
    appLog.info("auth: initializing persisted wallet session");
    const persisted = loadPersistedSession();
    if (!persisted) {
      appLog.info("auth: no persisted wallet session found");
      this.session = defaultSessionState();
      this.emit();
      return;
    }

    appLog.info("auth: restoring persisted wallet session", persisted);
    this.setLoading();
    try {
      if (persisted.mode === "local") {
        const localIdentity = loadLocalXmtpIdentity();
        if (localIdentity) {
          this.setLocalIdentity(localIdentity);
          appLog.info("auth: persisted local XMTP session restored", { address: shortHash(localIdentity.address, 10, 6) });
        } else {
          appLog.warn("auth: persisted local XMTP session had no stored identity");
          clearPersistedSession();
          clearSiweSession();
          this.session = defaultSessionState();
          this.emit();
        }
        return;
      }

      if (persisted.mode === "injected") {
        await this.connectInjected({ requestAccounts: false });
        appLog.info("auth: persisted browser wallet session restored", persisted);
        return;
      }

      if (persisted.mode === "walletconnect") {
        await this.connectWalletConnect({ showQrModal: false });
      }
      appLog.info("auth: persisted wallet session restored", persisted);
    } catch (error) {
      appLog.warn("auth: failed to restore persisted wallet session", error);
      clearPersistedSession();
      clearSiweSession();
      this.session = defaultSessionState();
      this.emit();
    }
  }

  listExternalWallets(): Array<{ id: string; label: string }> {
    const wallets: Array<{ id: string; label: string }> = [];
    if (installedProvider()) {
      wallets.push({ id: "browser", label: "Browser wallet" });
    }
    if (env.walletConnectProjectId) {
      wallets.push({ id: "walletconnect", label: "WalletConnect QR" });
    }
    return wallets;
  }

  async connectPrimary(): Promise<void> {
    appLog.info("auth: primary login requested", {
      hasBrowserWallet: Boolean(installedProvider()),
      walletConnectConfigured: Boolean(env.walletConnectProjectId)
    });
    if (installedProvider()) {
      try {
        await this.connectExternal("browser");
        return;
      } catch (error) {
        if (!env.walletConnectProjectId) {
          throw error;
        }
        appLog.warn("auth: browser wallet login failed, falling back to WalletConnect", error);
      }
    }
    appLog.info("auth: using WalletConnect for primary login");
    await this.connectExternal("walletconnect");
  }

  async connectExternal(walletId: string): Promise<void> {
    appLog.info("auth: external wallet login requested", { walletId });
    this.setLoading();
    try {
      if (walletId === "browser") {
        await this.connectInjected({ requestAccounts: true });
      } else if (walletId === "walletconnect") {
        await this.connectWalletConnect({ showQrModal: true });
      } else {
        throw new Error(`Unknown wallet connector: ${walletId}`);
      }
      await this.signInWithEthereum();
      appLog.info("auth: external wallet login completed", {
        walletId,
        address: this.session.address ? shortHash(this.session.address, 10, 6) : null,
        siweIssuedAt: this.session.siweIssuedAt
      });
    } catch (error) {
      appLog.error("auth: external wallet login failed", { walletId, error });
      await this.resetConnection();
      this.setError(error instanceof Error ? error.message : "Wallet connection failed.");
      throw error;
    }
  }

  getActiveProvider(): WalletProvider | null {
    return this.activeProvider;
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
      clearPersistedSession();
      clearSiweSession();
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
      return new Wallet(identity.privateKey, BASE_RPC_PROVIDER);
    }

    if (!this.activeProvider || !this.session.address) {
      appLog.warn("wallet: signer requested before wallet connection");
      throw new Error("Connect a wallet first.");
    }

    appLog.info("wallet: resolving signer from active provider", {
      mode: this.session.mode,
      address: shortHash(this.session.address, 10, 6)
    });
    const provider = new BrowserProvider(this.activeProvider);
    return provider.getSigner(this.session.address);
  }

  getXmtpIdentity(): BrowserXmtpIdentity | null {
    if (this.localIdentity && this.session.address === this.localIdentity.address) {
      return {
        address: this.localIdentity.address,
        privateKey: this.localIdentity.privateKey
      };
    }

    if (!this.activeProvider || !this.session.address) {
      return null;
    }

    return {
      address: this.session.address,
      signMessage: async (message: string) => {
        const signer = await this.getSigner();
        return signer.signMessage(message);
      }
    };
  }

  async disconnect(): Promise<void> {
    appLog.info("auth: disconnect requested", {
      walletId: this.session.walletId,
      mode: this.session.mode,
      address: this.session.address ? shortHash(this.session.address, 10, 6) : null
    });
    await this.resetConnection();
    this.session = defaultSessionState();
    this.emit();
    appLog.info("auth: disconnected");
  }

  walletLabel(walletId: string | null): string {
    return walletId ? walletLabel(walletId) : "-";
  }
}
