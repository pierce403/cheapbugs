import { activeStorageProvider } from "./storage";
import { authController } from "./services";
import { AppRouter } from "./router";
import { renderAboutView } from "./views/about";
import { renderHomeView } from "./views/home";
import { renderLoginView } from "./views/login";
import { renderManageView } from "./views/manage";
import { renderPatronsView } from "./views/patrons";
import { renderProfileView } from "./views/profile";
import { renderReportView } from "./views/report";
import { renderReviewView } from "./views/review";
import { renderStakeView } from "./views/stake";
import { renderSubmitView } from "./views/submit";
import { renderTreasuryView } from "./views/treasury";
import { renderTokenView } from "./views/token";
import { loadContractOwnerAccess } from "./contracts/cheapbugsSuite";
import { ENS_REGISTER_URL, ensProfileUrl } from "./lib/ens";
import { downloadTextFile } from "./lib/download";
import { appLog } from "./lib/logger";
import { loadBugzHeaderBalance, type HeaderBugzBalance } from "./lib/token";
import { escapeHtml, formatTokenAmount, shortHash } from "./lib/utils";
import { WalletActionCancelledError, type WalletActionOptions } from "./lib/walletAction";
import { buildInfo, formatBuildTime } from "./buildInfo";
import { chainConfig } from "./config/chains";
import { env } from "./config/env";
import type { AppNotice } from "./types/domain";
import type { SessionState } from "./types/app";
import type { AppViewContext, ContractOwnerViewState, ViewResult } from "./views/types";

const noticeId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const expectedLaunchDate = "June 1, 2026";
const githubRepoUrl = "https://github.com/pierce403/cheapbugs";

const renderBuildBadge = (): string => {
  const buildTime = formatBuildTime(buildInfo.builtAt);
  const label = `build ${buildInfo.id} / ${buildTime}`;
  return `<span class="build-badge" data-testid="build-badge" title="${escapeHtml(label)}">${escapeHtml(label)}</span>`;
};

const renderAvatarMedia = (
  session: SessionState,
  primary: string,
  className: string,
  testId: string
): string => {
  if (session.ensAvatarUrl) {
    return `<img class="${className}" data-testid="${testId}" src="${escapeHtml(session.ensAvatarUrl)}" alt="${escapeHtml(primary)} avatar" referrerpolicy="no-referrer" />`;
  }

  return `<div class="${className} identity-avatar-fallback" data-testid="${testId}">${escapeHtml(
    primary.slice(0, 1).toUpperCase()
  )}</div>`;
};

const renderIdentityBlock = (session: SessionState): string => {
  if (!session.address) {
    return `
      <div class="identity-chip">
        <div class="identity-avatar identity-avatar-fallback">?</div>
        <div class="identity-copy">
          <div class="identity-primary">anonymous</div>
          <div class="identity-secondary">connect a wallet to claim an ENS name and avatar</div>
        </div>
      </div>
    `;
  }

  const primary = session.ensName ?? shortHash(session.address, 14, 6);
  const secondary =
    session.ensLookupStatus === "loading"
      ? "resolving ENS profile..."
      : session.ensName
        ? shortHash(session.address, 12, 6)
        : session.ensLookupStatus === "error"
          ? "ENS lookup unavailable right now"
          : "no ENS name yet";

  return `
    <div class="identity-chip">
      <button id="profile-avatar-button" class="identity-avatar-button" type="button" aria-label="open profile" aria-haspopup="dialog">
        ${renderAvatarMedia(session, primary, "identity-avatar", "identity-avatar-media")}
      </button>
      <div class="identity-copy">
        <div class="identity-primary">${escapeHtml(primary)}</div>
        <div class="identity-secondary">${secondary}</div>
      </div>
    </div>
  `;
};

type BugzHeaderState =
  | { status: "idle"; address: null }
  | { status: "loading"; address: `0x${string}`; requestId: number }
  | { status: "ready"; address: `0x${string}`; balance: HeaderBugzBalance }
  | { status: "error"; address: `0x${string}`; errorMessage: string };
type WalletOnboardingMode = "walletconnect" | "embedded";
type WalletActionState = {
  id: number;
  title: string;
  message: string;
};

const renderBugzStatus = (session: SessionState, tokenHref: string, state: BugzHeaderState): string => {
  if (!session.address) {
    return `<div class="bugz-chip">bugz: -</div>`;
  }

  if (state.address !== session.address || state.status === "loading") {
    return `<div class="bugz-chip">bugz: <a href="${tokenHref}" data-nav>loading</a></div>`;
  }

  if (state.status === "error") {
    return `<div class="bugz-chip" title="${escapeHtml(state.errorMessage)}">bugz: <a href="${tokenHref}" data-nav>unavailable</a></div>`;
  }

  const balanceState = state.balance;
  const balance =
    balanceState.connectedBalance !== null
      ? `${formatTokenAmount(balanceState.connectedBalance, balanceState.decimals)} ${balanceState.symbol}`
      : "unavailable";
  return `<div class="bugz-chip" title="${escapeHtml(balanceState.errorMessage ?? "")}">bugz: <a href="${tokenHref}" data-nav>${escapeHtml(balance)}</a></div>`;
};

const bugzHeaderErrorDetails = (
  address: `0x${string}`,
  errorMessage: string,
  error?: unknown
): Record<string, unknown> => {
  const details: Record<string, unknown> = {
    address: shortHash(address, 10, 6),
    errorMessage,
    rpcUrl: chainConfig.rpcUrl,
    chainId: chainConfig.id,
    bugzTokenAddress: chainConfig.bugzTokenAddress,
    guidance: "Check that VITE_CHAIN_RPC_URL points to Base mainnet and VITE_BUGZ_TOKEN_ADDRESS is the live BUGZ token."
  };
  if (error !== undefined) {
    details.error = error;
  }
  return details;
};

const isBaseRateLimitMessage = (message: string): boolean =>
  /\b429\b|too many requests|rate.?limit|temporarily rate-limiting/i.test(message);

const BUGZ_HEADER_RATE_LIMIT_LOG_COOLDOWN_MS = 60_000;
const lastBugzHeaderRateLimitLogAt = new Map<string, number>();

const logBugzHeaderReadProblem = (
  address: `0x${string}`,
  errorMessage: string,
  error?: unknown
): void => {
  const details = bugzHeaderErrorDetails(address, errorMessage, error);
  if (isBaseRateLimitMessage(errorMessage)) {
    const now = Date.now();
    const key = address.toLowerCase();
    if (now - (lastBugzHeaderRateLimitLogAt.get(key) ?? 0) < BUGZ_HEADER_RATE_LIMIT_LOG_COOLDOWN_MS) {
      return;
    }
    lastBugzHeaderRateLimitLogAt.set(key, now);
    appLog.warn("token: header BUGZ status rate-limited", details);
    return;
  }

  appLog.error("token: header BUGZ status load failed", details);
};

const logBugzHeaderDashboardFailure = (address: `0x${string}`, balance: HeaderBugzBalance): void => {
  if (!balance.errorMessage && balance.connectedBalance !== null) {
    return;
  }

  logBugzHeaderReadProblem(
    address,
    balance.errorMessage ?? "BUGZ balance read returned no value for the connected wallet."
  );
};

const loadBugzHeaderDashboard = async (
  address: `0x${string}`,
  onResult: (state: BugzHeaderState) => void
): Promise<void> => {
  try {
    const balance = await loadBugzHeaderBalance(address);
    logBugzHeaderDashboardFailure(address, balance);
    onResult({ status: "ready", address, balance });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "BUGZ dashboard read failed before a dashboard could be built.";
    logBugzHeaderReadProblem(address, errorMessage, error);
    onResult({ status: "error", address, errorMessage });
  }
};

const renderProfileModal = (session: SessionState, bugzStatus: string): string => {
  if (!session.address) {
    return "";
  }

  const primary = session.ensName ?? shortHash(session.address, 14, 6);
  const ensStatus =
    session.ensLookupStatus === "loading"
      ? "resolving"
      : session.ensLookupStatus === "resolved"
        ? "resolved"
        : session.ensLookupStatus === "error"
          ? "lookup unavailable"
          : "not registered";
  const ensCell = session.ensName ? escapeHtml(session.ensName) : `<span class="warning-copy">no ENS primary name</span>`;
  const avatarCell = session.ensAvatarUrl
    ? `<a href="${escapeHtml(session.ensAvatarUrl)}" target="_blank" rel="noreferrer">ENS avatar record</a>`
    : "fallback until an ENS avatar is set";
  const ensAction = session.ensName
    ? `
      <a class="button" href="${escapeHtml(ensProfileUrl(session.ensName))}" target="_blank" rel="noreferrer">
        edit ENS profile
      </a>
    `
    : `
      <a class="button" href="${ENS_REGISTER_URL}" target="_blank" rel="noreferrer">
        register ENS name
      </a>
    `;
  const ensPrompt = session.ensName
    ? "CheapBugs reads this name and avatar from ENS. Profile edits happen in the ENS App."
    : "No ENS primary name was found for this wallet. Register one to show a name and avatar here.";
  const refreshDisabled = session.ensLookupStatus === "loading" ? "disabled" : "";
  const embeddedKeyAction =
    session.mode === "local"
      ? `<button id="export-embedded-key" class="button secondary" type="button">export cheapbugs-key.json</button>`
      : "";

  return `
    <div class="profile-modal-backdrop" data-profile-modal-close>
      <section class="profile-modal panel" role="dialog" aria-modal="true" aria-label="profile">
        <div class="profile-modal-header">
          <div class="panel-title">[ profile ]</div>
          <button class="notice-close" type="button" aria-label="close profile" data-profile-modal-close>x</button>
        </div>
        <div class="profile-modal-body">
          ${renderAvatarMedia(session, primary, "profile-avatar", "profile-avatar-media")}
          <div class="profile-summary">
            <div class="identity-primary">${escapeHtml(primary)}</div>
            <p class="helper-copy">${escapeHtml(ensPrompt)}</p>
          </div>
        </div>
        <table class="data-table compact-table profile-table">
          <tbody>
            <tr><th>ENS</th><td>${ensCell}</td></tr>
            <tr><th>ENS status</th><td>${escapeHtml(ensStatus)}</td></tr>
            <tr><th>avatar</th><td>${avatarCell}</td></tr>
            <tr><th>wallet</th><td><code>${escapeHtml(session.address)}</code></td></tr>
            <tr><th>BUGZ</th><td>${bugzStatus}</td></tr>
            <tr><th>reviewer</th><td>${session.isReviewer ? "trusted" : "no"}</td></tr>
          </tbody>
        </table>
        <div class="button-row profile-actions">
          ${ensAction}
          ${embeddedKeyAction}
          <button id="refresh-ens-profile" class="button secondary" type="button" ${refreshDisabled}>refresh ENS profile</button>
          <button class="button secondary" type="button" data-profile-modal-close>close</button>
        </div>
      </section>
    </div>
  `;
};

const renderWalletOnboardingModal = (mode: WalletOnboardingMode | null): string => {
  if (!mode) {
    return "";
  }

  if (mode === "walletconnect") {
    return `
      <div class="profile-modal-backdrop" data-wallet-onboarding-close>
        <section class="profile-modal panel" role="dialog" aria-modal="true" aria-label="connect wallet">
          <div class="profile-modal-header">
            <div class="panel-title">[ connect wallet ]</div>
            <button class="notice-close" type="button" aria-label="close wallet options" data-wallet-onboarding-close>x</button>
          </div>
          <div class="profile-summary">
            <p class="helper-copy">
              WalletConnect is for people who already have a crypto wallet. If you do not have one, create or import an
              embedded CheapBugs wallet instead.
            </p>
          </div>
          <div class="button-row profile-actions">
            <button id="connect-walletconnect-modal" class="button" type="button">connect with WalletConnect</button>
            <button id="reset-walletconnect-modal" class="button secondary" type="button">reset WalletConnect</button>
            <button id="open-embedded-wallet-modal" class="button secondary" type="button">I don't have a crypto wallet</button>
            <button class="button secondary" type="button" data-wallet-onboarding-close>cancel</button>
          </div>
        </section>
      </div>
    `;
  }

  const hasEmbeddedWallet = authController.hasLocalIdentity();
  return `
    <div class="profile-modal-backdrop" data-wallet-onboarding-close>
      <section class="profile-modal panel" role="dialog" aria-modal="true" aria-label="embedded wallet">
        <div class="profile-modal-header">
          <div class="panel-title">[ embedded wallet ]</div>
          <button class="notice-close" type="button" aria-label="close embedded wallet" data-wallet-onboarding-close>x</button>
        </div>
        <div class="profile-summary">
          <p class="helper-copy">
            The embedded CheapBugs wallet is saved in this browser's localStorage. It signs smart contract transactions
            and XMTP messages. Export <code>cheapbugs-key.json</code> and keep it private before relying on this wallet.
          </p>
        </div>
        <div class="button-row profile-actions">
          ${
            hasEmbeddedWallet
              ? `<button id="use-embedded-wallet-modal" class="button" type="button">use stored embedded wallet</button>
                 <button id="export-embedded-key-modal" class="button secondary" type="button">export cheapbugs-key.json</button>`
              : `<button id="generate-embedded-wallet-modal" class="button" type="button">generate embedded wallet</button>`
          }
          <button id="choose-embedded-key-modal" class="button secondary" type="button">import cheapbugs-key.json</button>
          <input id="import-embedded-key-modal" type="file" accept="application/json,.json" style="display: none" />
          <button class="button secondary" type="button" data-wallet-onboarding-close>cancel</button>
        </div>
      </section>
    </div>
  `;
};

const renderWalletActionModal = (state: WalletActionState | null): string => {
  const hidden = state ? "" : "hidden";
  const title = state?.title ?? "waiting for wallet";
  const message = state?.message ?? "Approve or reject the wallet request.";
  return `
    <div id="wallet-action-modal" class="processing-modal-backdrop" ${hidden} role="dialog" aria-modal="true" aria-label="wallet request">
      <div class="panel processing-modal wallet-action-modal">
        <div class="signature-spinner" aria-hidden="true"></div>
        <div class="signature-modal-copy">
          <strong id="wallet-action-title">${escapeHtml(title)}</strong>
          <p id="wallet-action-message">${escapeHtml(message)}</p>
          <p class="helper-copy">
            Reject the prompt in your wallet to cancel the wallet request. This button stops CheapBugs from waiting.
          </p>
          <div class="modal-actions">
            <button id="wallet-action-cancel" class="button secondary" type="button">cancel</button>
          </div>
        </div>
      </div>
    </div>
  `;
};

export class CheapBugsApp {
  private readonly router = new AppRouter();
  private notices: AppNotice[] = [];
  private renderToken = 0;
  private profileModalOpen = false;
  private bugzHeaderState: BugzHeaderState = { status: "idle", address: null };
  private bugzHeaderRequestId = 0;
  private ownerAccessState: ContractOwnerViewState = { status: "idle", address: null };
  private ownerAccessRequestId = 0;
  private walletOnboardingMode: WalletOnboardingMode | null = null;
  private walletActionState: WalletActionState | null = null;
  private walletActionRequestId = 0;
  private cancelWalletAction: (() => void) | null = null;

  constructor(private readonly root: HTMLElement) {}

  async start(): Promise<void> {
    this.router.subscribe(() => {
      void this.render();
    });

    authController.subscribe(() => {
      void this.render();
    });

    this.router.start();
    await authController.initialize();
    await this.render();
  }

  private buildContext(): AppViewContext {
    return {
      route: this.router.getRoute(),
      session: authController.getSession(),
      ownerAccess: this.ownerAccessState,
      router: this.router,
      storage: activeStorageProvider(),
      notices: this.notices,
      notify: (tone, message) => {
        this.notices = [...this.notices, { id: noticeId(), tone, message }];
        void this.render();
      },
      dismissNotice: (id) => {
        this.notices = this.notices.filter((notice) => notice.id !== id);
        void this.render();
      },
      openWalletOnboarding: (mode = "walletconnect") => {
        this.walletOnboardingMode = mode;
        void this.render();
      },
      runWalletAction: (options, work) => this.runWalletAction(options, work),
      rerender: () => this.render()
    };
  }

  private syncWalletActionModal(): void {
    const modal = this.root.querySelector<HTMLElement>("#wallet-action-modal");
    const title = this.root.querySelector<HTMLElement>("#wallet-action-title");
    const message = this.root.querySelector<HTMLElement>("#wallet-action-message");
    if (!modal || !title || !message) {
      return;
    }

    if (!this.walletActionState) {
      modal.setAttribute("hidden", "");
      title.textContent = "waiting for wallet";
      message.textContent = "Approve or reject the wallet request.";
      return;
    }

    title.textContent = this.walletActionState.title;
    message.textContent = this.walletActionState.message;
    modal.removeAttribute("hidden");
  }

  private async runWalletAction<T>(options: WalletActionOptions, work: () => Promise<T>): Promise<T> {
    const id = ++this.walletActionRequestId;
    let rejectCancel: (error: WalletActionCancelledError) => void = () => {};
    const cancelPromise = new Promise<never>((_resolve, reject) => {
      rejectCancel = reject;
    });

    this.walletActionState = {
      id,
      title: options.title,
      message: options.message
    };
    this.cancelWalletAction = () => {
      if (this.walletActionState?.id !== id) {
        return;
      }
      this.walletActionState = null;
      this.cancelWalletAction = null;
      this.syncWalletActionModal();
      rejectCancel(new WalletActionCancelledError());
    };
    this.syncWalletActionModal();

    const actionPromise = Promise.resolve().then(work);
    actionPromise.catch(() => {});

    try {
      return await Promise.race([actionPromise, cancelPromise]);
    } finally {
      if (this.walletActionState?.id === id) {
        this.walletActionState = null;
        this.cancelWalletAction = null;
        this.syncWalletActionModal();
      }
    }
  }

  private async resolveView(context: AppViewContext): Promise<ViewResult> {
    switch (context.route.name) {
      case "submit":
        return renderSubmitView(context);
      case "about":
        return renderAboutView(context);
      case "report":
        return renderReportView(context);
      case "profile":
        return renderProfileView(context);
      case "review":
        return renderReviewView(context);
      case "bond":
        return renderStakeView(context);
      case "manage":
        return renderManageView(context);
      case "treasury":
        return renderTreasuryView(context);
      case "token":
        return renderTokenView(context);
      case "patrons":
        return renderPatronsView(context);
      case "login":
        return renderLoginView(context);
      case "home":
      default:
        return renderHomeView(context);
    }
  }

  private ensureBugzHeaderLoad(session: SessionState): void {
    if (!session.address) {
      this.bugzHeaderState = { status: "idle", address: null };
      return;
    }

    if (
      this.bugzHeaderState.address === session.address &&
      (this.bugzHeaderState.status === "loading" ||
        this.bugzHeaderState.status === "ready" ||
        this.bugzHeaderState.status === "error")
    ) {
      return;
    }

    const requestId = ++this.bugzHeaderRequestId;
    const address = session.address;
    this.bugzHeaderState = { status: "loading", address, requestId };
    void loadBugzHeaderDashboard(address, (state) => {
      if (this.bugzHeaderRequestId !== requestId || authController.getSession().address !== address) {
        return;
      }

      this.bugzHeaderState = state;
      void this.render();
    });
  }

  private ensureOwnerAccessLoad(session: SessionState): void {
    if (!session.address) {
      this.ownerAccessState = { status: "idle", address: null };
      return;
    }

    if (
      this.ownerAccessState.address === session.address &&
      (this.ownerAccessState.status === "loading" ||
        this.ownerAccessState.status === "ready" ||
        this.ownerAccessState.status === "error")
    ) {
      return;
    }

    const requestId = ++this.ownerAccessRequestId;
    const address = session.address;
    this.ownerAccessState = { status: "loading", address, requestId };
    void loadContractOwnerAccess(address)
      .then((access) => {
        if (this.ownerAccessRequestId !== requestId || authController.getSession().address !== address) {
          return;
        }
        this.ownerAccessState = { status: "ready", address, access };
        void this.render();
      })
      .catch((error) => {
        if (this.ownerAccessRequestId !== requestId || authController.getSession().address !== address) {
          return;
        }
        const errorMessage = error instanceof Error ? error.message : "Contract owner lookup failed.";
        appLog.warn("manage: owner access lookup failed", { error });
        this.ownerAccessState = { status: "error", address, errorMessage };
        void this.render();
      });
  }

  private async shell(view: ViewResult, context: AppViewContext): Promise<string> {
    const session = context.session;
    if (!session.address) {
      this.profileModalOpen = false;
    }
    this.ensureBugzHeaderLoad(session);
    this.ensureOwnerAccessLoad(session);
    const bugzStatus = renderBugzStatus(session, context.router.href("/token"), this.bugzHeaderState);
    const profileModal = this.profileModalOpen ? renderProfileModal(session, bugzStatus) : "";
    const walletOnboardingModal = renderWalletOnboardingModal(this.walletOnboardingMode);
    const walletActionModal = renderWalletActionModal(this.walletActionState);
    const notices = context.notices
      .map(
        (notice) => `
          <div class="notice notice-${notice.tone}">
            <span>${escapeHtml(notice.message)}</span>
            <button type="button" class="notice-close" data-dismiss-notice="${escapeHtml(notice.id)}">x</button>
          </div>
        `
      )
      .join("");

    const navItems = [
      ["/", "index"],
      ["/submit", "submit"],
      ["/review", "review"],
      ["/bond", "bond"],
      ["/treasury", "treasury"],
      ["/token", "token"],
      ["/patrons", "patrons"]
    ];
    if (this.ownerAccessState.status === "ready" && this.ownerAccessState.access.isAnyOwner) {
      navItems.push(["/manage", "manage"]);
    }
    navItems.push(["/about", "about"]);
    const nav = navItems
      .map(
        ([path, label]) =>
          `<a href="${context.router.href(path)}" data-nav class="nav-link">${escapeHtml(label)}</a>`
      )
      .join("");

    const authControls = session.address
      ? `
        <div class="auth-panel">
          ${renderIdentityBlock(session)}
          ${bugzStatus}
          <div class="auth-actions">
            <button id="disconnect-wallet" class="button secondary" type="button">disconnect</button>
          </div>
        </div>
      `
      : `
        <div class="auth-panel auth-panel-guest">
          <div class="auth-actions">
            <button id="connect-wallet" class="button" type="button">login</button>
          </div>
        </div>
      `;

    return `
      <div class="shell">
        <aside class="development-banner panel" role="status" data-testid="development-banner">
          <strong>development preview</strong>
          <span>
            CheapBugs is under development, so some features might not work as expected.
            Expected launch: ${expectedLaunchDate}.
          </span>
        </aside>
        <header class="header panel">
          <div class="${session.address ? "banner banner-connected" : "banner banner-guest"}">
            <div class="brand-block">
              <img class="brand-mark" src="/cheapbugs-mark.png" alt="" aria-hidden="true" />
              <div>
                <div class="brand-row">
                  <div class="brand">cheapbugs</div>
                  <a class="brand-github" href="${githubRepoUrl}" target="_blank" rel="noreferrer" aria-label="GitHub repository">
                    <svg class="brand-github-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                      <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
                    </svg>
                  </a>
                  ${renderBuildBadge()}
                </div>
                <div class="subtitle">shitty bugs, competitive prices</div>
              </div>
            </div>
            ${authControls}
          </div>
          <nav class="nav-row">${nav}</nav>
        </header>
        <section class="notice-stack">${notices}</section>
        <main class="main-column" data-view-root>${view.html}</main>
        ${profileModal}
        ${walletOnboardingModal}
        ${walletActionModal}
      </div>
    `;
  }

  private exportEmbeddedKey(context: AppViewContext): void {
    try {
      downloadTextFile("cheapbugs-key.json", authController.exportLocalIdentityJson());
      context.notify("success", "cheapbugs-key.json exported. Keep it private.");
    } catch (error) {
      appLog.error("embedded-wallet: export failed", error);
      context.notify("error", error instanceof Error ? error.message : "Embedded wallet export failed.");
    }
  }

  private async importEmbeddedKeyFile(file: File | undefined, context: AppViewContext): Promise<void> {
    if (!file) {
      return;
    }

    try {
      const identity = await authController.importLocalIdentityFromJson(await file.text());
      this.walletOnboardingMode = null;
      context.notify("success", `Imported embedded CheapBugs wallet ${identity.address}.`);
      this.router.navigate("/");
    } catch (error) {
      appLog.error("embedded-wallet: import failed", error);
      context.notify("error", error instanceof Error ? error.message : "Embedded wallet import failed.");
    }
  }

  async render(): Promise<void> {
    const token = ++this.renderToken;
    this.ensureOwnerAccessLoad(authController.getSession());
    const context = this.buildContext();
    let view: ViewResult;

    try {
      view = await this.resolveView(context);
    } catch (error) {
      view = {
        title: "Runtime Error",
        html: `
          <section class="panel">
            <div class="panel-title">[ runtime error ]</div>
            <p class="warning-copy">${escapeHtml(error instanceof Error ? error.message : "Unexpected render error.")}</p>
          </section>
        `
      };
    }

    if (token !== this.renderToken) {
      return;
    }

    document.title = `${view.title} | ${env.appName}`;
    this.root.innerHTML = await this.shell(view, context);
    appLog.info("app: rendered route", {
      route: context.route.name,
      path: context.route.path,
      sessionStatus: context.session.status,
      wallet: context.session.address ? shortHash(context.session.address, 10, 6) : "anonymous"
    });

    this.root.querySelectorAll<HTMLAnchorElement>("[data-nav]").forEach((anchor) => {
      anchor.addEventListener("click", (event) => {
        event.preventDefault();
        const href = anchor.getAttribute("href");
        if (href) {
          appLog.info("ui: navigation click", { href, label: anchor.textContent?.trim() ?? "" });
          this.profileModalOpen = false;
          this.walletOnboardingMode = null;
          this.router.navigate(href.replace(/^#/, ""));
        }
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>("[data-dismiss-notice]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.dismissNotice;
        if (id) {
          appLog.info("ui: notice dismissed", { id });
          context.dismissNotice(id);
        }
      });
    });

    this.root.querySelector<HTMLButtonElement>("#wallet-action-cancel")?.addEventListener("click", () => {
      appLog.info("ui: wallet action cancelled");
      this.cancelWalletAction?.();
    });
    this.syncWalletActionModal();

    this.root.querySelector<HTMLButtonElement>("#connect-wallet")?.addEventListener("click", async () => {
      appLog.info("ui: header login click");
      if (!authController.isConfigured()) {
        this.walletOnboardingMode = "embedded";
        void this.render();
        return;
      }
      if (authController.primaryUsesWalletConnect()) {
        this.walletOnboardingMode = "walletconnect";
        void this.render();
        return;
      }
      try {
        await authController.connectPrimary();
        context.notify("success", "Signed in with wallet.");
      } catch (error) {
        appLog.error("ui: header login failed", error);
        context.notify("error", error instanceof Error ? error.message : "Wallet login failed.");
      }
    });

    this.root.querySelectorAll<HTMLElement>("[data-wallet-onboarding-close]").forEach((element) => {
      element.addEventListener("click", (event) => {
        if (event.currentTarget !== event.target && element.classList.contains("profile-modal-backdrop")) {
          return;
        }
        appLog.info("ui: wallet onboarding modal close");
        this.walletOnboardingMode = null;
        void this.render();
      });
    });

    this.root.querySelector<HTMLButtonElement>("#open-embedded-wallet-modal")?.addEventListener("click", () => {
      appLog.info("ui: no crypto wallet click");
      this.walletOnboardingMode = "embedded";
      void this.render();
    });

    this.root.querySelector<HTMLButtonElement>("#connect-walletconnect-modal")?.addEventListener("click", async () => {
      appLog.info("ui: WalletConnect modal connect click");
      try {
        await authController.connectExternal("walletConnect");
        this.walletOnboardingMode = null;
        context.notify("success", "Signed in with WalletConnect.");
      } catch (error) {
        appLog.error("ui: WalletConnect modal login failed", error);
        context.notify("error", error instanceof Error ? error.message : "WalletConnect login failed.");
      }
    });

    this.root.querySelector<HTMLButtonElement>("#reset-walletconnect-modal")?.addEventListener("click", async () => {
      appLog.info("ui: WalletConnect reset click");
      try {
        await authController.resetWalletConnectSession();
        context.notify("info", "WalletConnect session reset. Try connecting again.");
      } catch (error) {
        appLog.error("ui: WalletConnect reset failed", error);
        context.notify("error", error instanceof Error ? error.message : "WalletConnect reset failed.");
      }
    });

    this.root.querySelector<HTMLButtonElement>("#generate-embedded-wallet-modal")?.addEventListener("click", async () => {
      appLog.info("ui: generate embedded wallet click");
      try {
        const identity = await authController.createLocalIdentity();
        this.walletOnboardingMode = null;
        context.notify("success", `Embedded CheapBugs wallet created: ${identity.address}.`);
      } catch (error) {
        appLog.error("ui: generate embedded wallet failed", error);
        context.notify("error", error instanceof Error ? error.message : "Failed to create embedded wallet.");
      }
    });

    this.root.querySelector<HTMLButtonElement>("#use-embedded-wallet-modal")?.addEventListener("click", async () => {
      appLog.info("ui: use embedded wallet click");
      try {
        const identity = await authController.useLocalIdentity();
        this.walletOnboardingMode = null;
        context.notify("success", `Using embedded CheapBugs wallet ${identity.address}.`);
      } catch (error) {
        appLog.error("ui: use embedded wallet failed", error);
        context.notify("error", error instanceof Error ? error.message : "Failed to use embedded wallet.");
      }
    });

    this.root.querySelector<HTMLButtonElement>("#export-embedded-key-modal")?.addEventListener("click", () => {
      appLog.info("ui: export embedded key click");
      this.exportEmbeddedKey(context);
    });

    this.root.querySelector<HTMLButtonElement>("#choose-embedded-key-modal")?.addEventListener("click", () => {
      this.root.querySelector<HTMLInputElement>("#import-embedded-key-modal")?.click();
    });

    this.root.querySelector<HTMLInputElement>("#import-embedded-key-modal")?.addEventListener("change", async (event) => {
      const input = event.currentTarget as HTMLInputElement;
      await this.importEmbeddedKeyFile(input.files?.[0], context);
      input.value = "";
    });

    this.root.querySelector<HTMLButtonElement>("#profile-avatar-button")?.addEventListener("click", () => {
      appLog.info("ui: profile avatar click");
      this.profileModalOpen = true;
      void this.render();
    });

    this.root.querySelectorAll<HTMLElement>("[data-profile-modal-close]").forEach((element) => {
      element.addEventListener("click", (event) => {
        if (event.currentTarget !== event.target && element.classList.contains("profile-modal-backdrop")) {
          return;
        }
        appLog.info("ui: profile modal close");
        this.profileModalOpen = false;
        void this.render();
      });
    });

    this.root.querySelector<HTMLButtonElement>("#refresh-ens-profile")?.addEventListener("click", async () => {
      appLog.info("ui: profile ENS refresh click");
      try {
        await authController.refreshEnsProfile();
        context.notify("success", "ENS profile refreshed.");
      } catch (error) {
        appLog.warn("ui: profile ENS refresh failed", error);
        context.notify("error", error instanceof Error ? error.message : "ENS profile refresh failed.");
      }
    });

    this.root.querySelector<HTMLButtonElement>("#export-embedded-key")?.addEventListener("click", () => {
      appLog.info("ui: profile export embedded key click");
      this.exportEmbeddedKey(context);
    });

    this.root.querySelector<HTMLButtonElement>("#disconnect-wallet")?.addEventListener("click", async () => {
      appLog.info("ui: disconnect click");
      this.profileModalOpen = false;
      this.walletOnboardingMode = null;
      await authController.disconnect();
      context.notify("info", "Wallet disconnected.");
      this.router.navigate("/");
    });

    const mount = this.root.querySelector<HTMLElement>("[data-view-root]");
    if (mount && view.afterRender) {
      await view.afterRender(mount, context);
    }
  }
}
