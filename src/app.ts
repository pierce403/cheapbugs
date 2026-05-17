import { activeStorageProvider } from "./storage";
import { authController } from "./services";
import { AppRouter } from "./router";
import { renderHomeView } from "./views/home";
import { renderLoginView } from "./views/login";
import { renderPatronsView } from "./views/patrons";
import { renderReportView } from "./views/report";
import { renderReviewView } from "./views/review";
import { renderSubmitView } from "./views/submit";
import { renderTokenView } from "./views/token";
import { ENS_REGISTER_URL, ensProfileUrl } from "./lib/ens";
import { appLog } from "./lib/logger";
import { loadTokenDashboard } from "./lib/token";
import { escapeHtml, formatTokenAmount, shortHash } from "./lib/utils";
import { env } from "./config/env";
import type { AppNotice } from "./types/domain";
import type { SessionState } from "./types/app";
import type { AppViewContext, ViewResult } from "./views/types";

const noticeId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const expectedLaunchDate = "June 1, 2026";

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

const renderBugzStatus = async (session: SessionState, tokenHref: string): Promise<string> => {
  if (!session.address) {
    return `<div class="bugz-chip">bugz: -</div>`;
  }

  try {
    const dashboard = await loadTokenDashboard(session.address);
    const balance =
      dashboard.connectedBalance !== null
        ? `${formatTokenAmount(dashboard.connectedBalance, dashboard.decimals)} ${dashboard.symbol}`
        : "unavailable";
    if (dashboard.errorMessage) {
      appLog.warn("token: header balance read unavailable", { errorMessage: dashboard.errorMessage });
    }
    return `<div class="bugz-chip" title="${escapeHtml(dashboard.errorMessage ?? "")}">bugz: <a href="${tokenHref}" data-nav>${escapeHtml(balance)}</a></div>`;
  } catch (error) {
    appLog.warn("token: header dashboard read threw", { error });
    return `<div class="bugz-chip">bugz: unavailable</div>`;
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
          <button class="button secondary" type="button" data-profile-modal-close>close</button>
        </div>
      </section>
    </div>
  `;
};

export class CheapBugsApp {
  private readonly router = new AppRouter();
  private notices: AppNotice[] = [];
  private renderToken = 0;
  private profileModalOpen = false;

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
      rerender: () => this.render()
    };
  }

  private async resolveView(context: AppViewContext): Promise<ViewResult> {
    switch (context.route.name) {
      case "submit":
        return renderSubmitView(context);
      case "report":
        return renderReportView(context);
      case "review":
        return renderReviewView(context);
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

  private async shell(view: ViewResult, context: AppViewContext): Promise<string> {
    const session = context.session;
    if (!session.address) {
      this.profileModalOpen = false;
    }
    const bugzStatus = await renderBugzStatus(session, context.router.href("/token"));
    const profileModal = this.profileModalOpen ? renderProfileModal(session, bugzStatus) : "";
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

    const nav = [
      ["/", "index"],
      ["/submit", "submit"],
      ["/review", "review"],
      ["/token", "token"],
      ["/patrons", "patrons"]
    ]
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
          <div class="banner">
            <div class="brand-block">
              <img class="brand-mark" src="/cheapbugs-mark.png" alt="" aria-hidden="true" />
              <div>
                <div class="brand">cheapbugs</div>
                <div class="subtitle">shitty bugs, competitive prices</div>
              </div>
            </div>
            ${authControls}
          </div>
          <nav class="nav-row">${nav}</nav>
        </header>
        <section class="notice-stack">${notices}</section>
        <main class="main-column" data-view-root>${view.html}</main>
        <footer class="footer panel">
          <div>${escapeHtml(env.appName)} / static assets only / no database / no server renderer</div>
        </footer>
        ${profileModal}
      </div>
    `;
  }

  async render(): Promise<void> {
    const token = ++this.renderToken;
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

    this.root.querySelector<HTMLButtonElement>("#connect-wallet")?.addEventListener("click", async () => {
      appLog.info("ui: header login click");
      try {
        await authController.connectPrimary();
        context.notify("success", "Signed in with wallet.");
      } catch (error) {
        appLog.error("ui: header login failed", error);
        context.notify("error", error instanceof Error ? error.message : "Wallet login failed.");
      }
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

    this.root.querySelector<HTMLButtonElement>("#disconnect-wallet")?.addEventListener("click", async () => {
      appLog.info("ui: disconnect click");
      this.profileModalOpen = false;
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
