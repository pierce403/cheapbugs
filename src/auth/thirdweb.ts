import { createThirdwebClient } from "thirdweb";
import { autoConnect, createWallet, getInstalledWallets, inAppWallet, walletConnect } from "thirdweb/wallets";
import { getUserEmail, preAuthenticate } from "thirdweb/wallets/in-app";
import type { Wallet } from "thirdweb/wallets";

import { appChain } from "../config/chains";
import { env } from "../config/env";
import { isTrustedReviewer } from "../config/reviewers";
import { emptyEnsProfile, resolveEnsProfile } from "../lib/ens";
import { APP_METADATA } from "../lib/constants";
import { normalizeAddress } from "../lib/utils";
import type { SessionState } from "../types/app";

type SessionListener = (session: SessionState) => void;

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

const emailWallet = inAppWallet({
  auth: {
    options: ["email"]
  },
  executionMode: {
    mode: "EOA"
  }
});

const wcWallet = walletConnect();

const defaultSessionState = (): SessionState => ({
  status: "idle",
  walletId: null,
  address: null,
  email: null,
  mode: null,
  ...emptyEnsProfile(),
  isReviewer: false,
  lastError: null
});

export class ThirdwebAuthController {
  readonly client = thirdwebClient;
  private session: SessionState = defaultSessionState();
  private listeners = new Set<SessionListener>();
  private activeWallet: Wallet | null = null;
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

  private async setWallet(
    wallet: Wallet,
    mode: SessionState["mode"]
  ): Promise<void> {
    this.activeWallet = wallet;
    const account = wallet.getAccount();
    const email = mode === "email" ? (await getUserEmail({ client: requireThirdwebClient() })) ?? null : null;
    const address = account ? normalizeAddress(account.address) : null;

    this.session = {
      status: account ? "connected" : "idle",
      walletId: wallet.id,
      address,
      email,
      mode,
      ...this.nextEnsState(address),
      isReviewer: isTrustedReviewer(address),
      lastError: null
    };

    this.watchWallet(wallet, mode);
    this.emit();

    if (address) {
      void this.hydrateEnsProfile(address);
    }
  }

  private watchWallet(
    wallet: Wallet,
    mode: SessionState["mode"]
  ): void {
    wallet.subscribe("accountChanged", async (account) => {
      const address = account ? normalizeAddress(account.address) : null;
      this.session = {
        ...this.session,
        address,
        isReviewer: isTrustedReviewer(account?.address),
        mode,
        ...this.nextEnsState(address)
      };
      this.emit();

      if (address) {
        void this.hydrateEnsProfile(address);
      } else {
        this.ensLookupToken += 1;
      }
    });

    wallet.subscribe("disconnect", () => {
      this.ensLookupToken += 1;
      this.activeWallet = null;
      this.session = defaultSessionState();
      this.emit();
    });
  }

  async initialize(): Promise<void> {
    if (!thirdwebClient) {
      this.session = {
        ...defaultSessionState(),
        status: "error",
        lastError: thirdwebDisabledMessage
      };
      this.emit();
      return;
    }

    this.session = {
      ...this.session,
      status: "loading"
    };
    this.emit();

    try {
      const wallets = [emailWallet, wcWallet, ...getInstalledWallets()];
      await autoConnect({
        client: requireThirdwebClient(),
        chain: appChain,
        wallets,
        appMetadata: APP_METADATA,
        onConnect: async (wallet) => {
          const mode = wallet.id === "inApp" ? "email" : "external";
          await this.setWallet(wallet, mode);
        }
      });

      if (!this.activeWallet) {
        this.session = defaultSessionState();
        this.emit();
      }
    } catch (error) {
      this.session = {
        ...defaultSessionState(),
        status: "error",
        lastError: error instanceof Error ? error.message : "Auto-connect failed."
      };
      this.emit();
    }
  }

  async sendEmailCode(email: string): Promise<void> {
    if (!thirdwebClient) {
      const error = new Error(thirdwebDisabledMessage);
      this.session = {
        ...defaultSessionState(),
        status: "error",
        lastError: error.message
      };
      this.emit();
      throw error;
    }

    this.session = {
      ...this.session,
      status: "loading",
      lastError: null
    };
    this.emit();

    try {
      await preAuthenticate({
        client: requireThirdwebClient(),
        strategy: "email",
        email
      });
      this.session = {
        ...this.session,
        status: "idle"
      };
      this.emit();
    } catch (error) {
      this.session = {
        ...this.session,
        status: "error",
        lastError: error instanceof Error ? error.message : "Failed to send verification code."
      };
      this.emit();
      throw error;
    }
  }

  async connectEmail(email: string, verificationCode: string): Promise<void> {
    if (!thirdwebClient) {
      const error = new Error(thirdwebDisabledMessage);
      this.session = {
        ...defaultSessionState(),
        status: "error",
        lastError: error.message
      };
      this.emit();
      throw error;
    }

    this.session = {
      ...this.session,
      status: "loading",
      lastError: null
    };
    this.emit();

    try {
      await emailWallet.connect({
        client: requireThirdwebClient(),
        chain: appChain,
        strategy: "email",
        email,
        verificationCode
      });
      await this.setWallet(emailWallet, "email");
    } catch (error) {
      this.session = {
        ...defaultSessionState(),
        status: "error",
        lastError: error instanceof Error ? error.message : "Email login failed."
      };
      this.emit();
      throw error;
    }
  }

  listExternalWallets(): Array<{ id: string; label: string }> {
    if (!thirdwebClient) {
      return [];
    }

    const installed = getInstalledWallets().map((wallet) => ({
      id: wallet.id,
      label: wallet.id
    }));

    return [
      ...installed,
      {
        id: "walletConnect",
        label: "WalletConnect QR"
      }
    ];
  }

  async connectExternal(walletId: string): Promise<void> {
    if (!thirdwebClient) {
      const error = new Error(thirdwebDisabledMessage);
      this.session = {
        ...defaultSessionState(),
        status: "error",
        lastError: error.message
      };
      this.emit();
      throw error;
    }

    const wallet =
      walletId === "walletConnect"
        ? wcWallet
        : getInstalledWallets().find((entry) => entry.id === walletId) ?? createWallet(walletId as never);

    this.session = {
      ...this.session,
      status: "loading",
      lastError: null
    };
    this.emit();

    try {
      if (wallet.id === "walletConnect") {
        await wallet.connect({
          client: requireThirdwebClient(),
          chain: appChain,
          walletConnect: {
            showQrModal: true,
            appMetadata: APP_METADATA
          }
        });
      } else {
        await wallet.connect({
          client: requireThirdwebClient(),
          chain: appChain
        });
      }

      await this.setWallet(wallet, "external");
    } catch (error) {
      this.session = {
        ...defaultSessionState(),
        status: "error",
        lastError: error instanceof Error ? error.message : "Wallet connection failed."
      };
      this.emit();
      throw error;
    }
  }

  getActiveAccount() {
    return this.activeWallet?.getAccount();
  }

  getActiveWallet() {
    return this.activeWallet;
  }

  async disconnect(): Promise<void> {
    await this.activeWallet?.disconnect();
    this.ensLookupToken += 1;
    this.activeWallet = null;
    this.session = defaultSessionState();
    this.emit();
  }
}
