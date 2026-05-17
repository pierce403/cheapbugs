import EthereumProvider from "@walletconnect/ethereum-provider";
import { BrowserProvider, JsonRpcProvider, Wallet, type Eip1193Provider, type Signer } from "ethers";

import { chainConfig } from "../config/chains";
import { env } from "../config/env";
import { isTrustedReviewer } from "../config/reviewers";
import { APP_METADATA } from "../lib/constants";
import { emptyEnsProfile, resolveEnsProfile } from "../lib/ens";
import { normalizeAddress } from "../lib/utils";
import type { SessionState } from "../types/app";
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

const AUTH_SESSION_KEY = "cheapbugs.walletSession.v1";
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
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex() }]
    });
  } catch (error) {
    const code = (error as { code?: number | string })?.code;
    if (code !== 4902 && code !== "4902") {
      throw error;
    }
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [chainParams()]
    });
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
    this.session = {
      ...this.session,
      status: "loading",
      lastError: null
    };
    this.emit();
  }

  private setError(message: string): void {
    this.ensLookupToken += 1;
    this.session = {
      ...defaultSessionState(),
      status: "error",
      lastError: message
    };
    this.emit();
  }

  private setConnected(
    address: `0x${string}`,
    walletId: string,
    mode: WalletMode,
    provider: WalletProvider | null
  ): void {
    this.activeProvider = provider;
    this.localIdentity = mode === "local" ? this.localIdentity : null;
    this.session = {
      status: "connected",
      walletId,
      address,
      mode,
      ...this.nextEnsState(address),
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
      const accounts = Array.isArray(payload) ? payload : [];
      const address = accounts[0] ? normalizeAddress(String(accounts[0])) : null;
      if (!address) {
        void this.disconnect();
        return;
      }
      this.setConnected(address, walletId, mode, provider);
    };
    const onDisconnect = () => {
      void this.disconnect();
    };

    provider.on?.("accountsChanged", onAccountsChanged);
    provider.on?.("disconnect", onDisconnect);
    this.teardownProviderListeners = () => {
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("disconnect", onDisconnect);
    };
  }

  private setLocalIdentity(identity: LocalXmtpIdentity): void {
    this.teardownProviderListeners?.();
    this.teardownProviderListeners = null;
    this.activeProvider = null;
    this.activeWalletConnect = null;
    this.localIdentity = identity;
    this.setConnected(identity.address, "local-xmtp", "local", null);
  }

  private async connectInjected({ requestAccounts }: { requestAccounts: boolean }): Promise<void> {
    const provider = installedProvider();
    if (!provider) {
      throw new Error("No browser wallet was found. Use WalletConnect QR or install a web3 wallet extension.");
    }

    const accounts = requestAccounts
      ? ((await provider.request({ method: "eth_requestAccounts" })) as string[] | undefined) ?? []
      : await getInjectedAccounts(provider);
    const address = accounts[0] ? normalizeAddress(String(accounts[0])) : null;
    if (!address) {
      throw new Error("Browser wallet is not connected to this site.");
    }
    await requestBaseChain(provider);

    this.activeWalletConnect = null;
    this.watchProvider(provider, "injected", "browser");
    this.setConnected(address, "browser", "injected", provider);
  }

  private async initWalletConnect(showQrModal: boolean): Promise<EthereumProvider> {
    if (!env.walletConnectProjectId) {
      throw new Error("Set VITE_WALLETCONNECT_PROJECT_ID to enable WalletConnect QR login.");
    }

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
      await provider.connect({
        chains: [chainConfig.id],
        optionalChains: [chainConfig.id]
      });
    }

    const accounts = ((await provider.request({ method: "eth_accounts" })) as string[] | undefined) ?? provider.accounts;
    const address = accounts[0] ? normalizeAddress(String(accounts[0])) : null;
    if (!address) {
      throw new Error("WalletConnect connected without an account.");
    }

    this.activeWalletConnect = provider;
    this.watchProvider(provider as WalletProvider, "walletconnect", "walletconnect");
    this.setConnected(address, "walletconnect", "walletconnect", provider as WalletProvider);
  }

  async initialize(): Promise<void> {
    const persisted = loadPersistedSession();
    if (!persisted) {
      this.session = defaultSessionState();
      this.emit();
      return;
    }

    this.setLoading();
    try {
      if (persisted.mode === "local") {
        const localIdentity = loadLocalXmtpIdentity();
        if (localIdentity) {
          this.setLocalIdentity(localIdentity);
        } else {
          clearPersistedSession();
          this.session = defaultSessionState();
          this.emit();
        }
        return;
      }

      if (persisted.mode === "injected") {
        await this.connectInjected({ requestAccounts: false });
        return;
      }

      if (persisted.mode === "walletconnect") {
        await this.connectWalletConnect({ showQrModal: false });
      }
    } catch {
      clearPersistedSession();
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
    if (installedProvider()) {
      await this.connectExternal("browser");
      return;
    }
    await this.connectExternal("walletconnect");
  }

  async connectExternal(walletId: string): Promise<void> {
    this.setLoading();
    try {
      if (walletId === "browser") {
        await this.connectInjected({ requestAccounts: true });
      } else if (walletId === "walletconnect") {
        await this.connectWalletConnect({ showQrModal: true });
      } else {
        throw new Error(`Unknown wallet connector: ${walletId}`);
      }
    } catch (error) {
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
    if (loadLocalXmtpIdentity()) {
      throw new Error("A local XMTP wallet already exists in this browser. Use it or forget it before creating a new one.");
    }
    const identity = createLocalXmtpIdentity();
    this.setLocalIdentity(identity);
    return identity;
  }

  async useLocalIdentity(): Promise<LocalXmtpIdentity> {
    const identity = loadLocalXmtpIdentity() ?? createLocalXmtpIdentity();
    saveLocalXmtpIdentity(identity);
    this.setLocalIdentity(identity);
    return identity;
  }

  forgetLocalIdentity(): void {
    clearLocalXmtpIdentity();
    if (this.session.mode === "local") {
      this.ensLookupToken += 1;
      this.localIdentity = null;
      clearPersistedSession();
      this.session = defaultSessionState();
      this.emit();
    }
  }

  async getSigner(): Promise<Signer> {
    if (this.session.mode === "local") {
      const identity = this.getLocalIdentity();
      if (!identity) {
        throw new Error("Stored local XMTP wallet is missing.");
      }
      return new Wallet(identity.privateKey, BASE_RPC_PROVIDER);
    }

    if (!this.activeProvider || !this.session.address) {
      throw new Error("Connect a wallet first.");
    }

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
    this.teardownProviderListeners?.();
    this.teardownProviderListeners = null;
    try {
      await this.activeWalletConnect?.disconnect();
    } catch {
      // Some wallets consider an already-ended session a successful disconnect.
    }
    this.ensLookupToken += 1;
    this.activeProvider = null;
    this.activeWalletConnect = null;
    this.localIdentity = null;
    clearPersistedSession();
    this.session = defaultSessionState();
    this.emit();
  }

  walletLabel(walletId: string | null): string {
    return walletId ? walletLabel(walletId) : "-";
  }
}
