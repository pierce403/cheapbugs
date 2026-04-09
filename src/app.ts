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
import { ENS_APP_URL } from "./lib/ens";
import { escapeHtml, shortHash } from "./lib/utils";
import { env } from "./config/env";
import { chainConfig } from "./config/chains";
import type { AppNotice } from "./types/domain";
import type { SessionState } from "./types/app";
import type { AppViewContext, ViewResult } from "./views/types";

const noticeId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

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
          : `no ENS name yet / <a href="${ENS_APP_URL}" target="_blank" rel="noreferrer">create one</a>`;

  const avatar = session.ensAvatarUrl
    ? `<img class="identity-avatar" src="${escapeHtml(session.ensAvatarUrl)}" alt="${escapeHtml(primary)} avatar" />`
    : `<div class="identity-avatar identity-avatar-fallback">${escapeHtml(primary.slice(0, 1).toUpperCase())}</div>`;

  return `
    <div class="identity-chip">
      ${avatar}
      <div class="identity-copy">
        <div class="identity-primary">${escapeHtml(primary)}</div>
        <div class="identity-secondary">${secondary}</div>
      </div>
    </div>
  `;
};

export class CheapBugsApp {
  private readonly router = new AppRouter();
  private notices: AppNotice[] = [];
  private renderToken = 0;

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

  private shell(view: ViewResult, context: AppViewContext): string {
    const session = context.session;
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
          <div class="auth-actions">
            <a href="${context.router.href("/login")}" data-nav class="button secondary">session</a>
            <button id="disconnect-wallet" class="button secondary" type="button">disconnect</button>
          </div>
          <div class="status-block">
            <div>chain: ${escapeHtml(chainConfig.name)} (${chainConfig.id})</div>
            <div>storage: ${escapeHtml(context.storage.id)}</div>
            <div>wallet: ${escapeHtml(shortHash(session.address, 12, 6))}</div>
            <div>reviewer: ${session.isReviewer ? "trusted" : "no"}</div>
          </div>
        </div>
      `
      : `
        <div class="auth-panel auth-panel-guest">
          <div class="auth-actions">
            <a href="${context.router.href("/login")}" data-nav class="button">login</a>
          </div>
          <div class="status-block">
            <div>chain: ${escapeHtml(chainConfig.name)} (${chainConfig.id})</div>
            <div>storage: ${escapeHtml(context.storage.id)}</div>
            <div>wallet: anonymous</div>
            <div>reviewer: no</div>
          </div>
        </div>
      `;

    return `
      <div class="shell">
        <header class="header panel">
          <div class="banner">
            <div>
              <div class="brand">cheapbugs</div>
              <div class="subtitle">shitty bugs, competitive prices</div>
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
    this.root.innerHTML = this.shell(view, context);

    this.root.querySelectorAll<HTMLAnchorElement>("[data-nav]").forEach((anchor) => {
      anchor.addEventListener("click", (event) => {
        event.preventDefault();
        const href = anchor.getAttribute("href");
        if (href) {
          this.router.navigate(href.replace(/^#/, ""));
        }
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>("[data-dismiss-notice]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.dismissNotice;
        if (id) {
          context.dismissNotice(id);
        }
      });
    });

    this.root.querySelector<HTMLButtonElement>("#disconnect-wallet")?.addEventListener("click", async () => {
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
