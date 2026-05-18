import { authController } from "../services";
import { registerSchema } from "../attest/eas";
import { chainConfig } from "../config/chains";
import { getSchemaCatalog } from "../lib/schema-overrides";
import { loadReviewQueue } from "../lib/reports";
import { escapeHtml, formatDate } from "../lib/utils";

import type { AppViewContext, ViewResult } from "./types";

export const renderReviewView = async (context: AppViewContext): Promise<ViewResult> => {
  const schemaRows = getSchemaCatalog()
    .map(
      (schema) => `
        <tr>
          <td>${escapeHtml(schema.name)}</td>
          <td>${escapeHtml(schema.uid || "missing")}</td>
          <td>${escapeHtml(schema.definition)}</td>
          <td><button class="button secondary" type="button" data-register-schema="${escapeHtml(schema.name)}">register</button></td>
        </tr>
      `
    )
    .join("");

  if (!context.session.isReviewer) {
    return {
      title: "Review",
      html: `
        <section class="panel">
          <div class="panel-title">[ reviewer queue ]</div>
          <p class="warning-copy">Reviewer access is restricted to addresses in the frontend allowlist. Connect an allowed wallet to continue.</p>
          <p><a href="${context.router.href("/login")}" data-nav>open /login</a></p>
        </section>

        <section class="panel">
          <div class="panel-title">[ bug index ]</div>
          <p>${escapeHtml(chainConfig.bugIndexAddress || "unset")}</p>
          <p class="helper-copy">bond vault: ${escapeHtml(chainConfig.bugBondVaultAddress)}</p>
          <p class="helper-copy">treasury vault: ${escapeHtml(chainConfig.bugTreasuryVaultAddress)}</p>
        </section>

        <section class="panel">
          <div class="panel-title">[ schema catalog ]</div>
          <table class="data-table compact-table">
            <thead><tr><th>schema</th><th>uid</th><th>definition</th><th>action</th></tr></thead>
            <tbody>${schemaRows}</tbody>
          </table>
        </section>
      `,
      afterRender: (root, appContext) => {
        root.querySelectorAll<HTMLButtonElement>("[data-register-schema]").forEach((button) => {
          button.addEventListener("click", async () => {
            const name = button.dataset.registerSchema;
            if (!name) {
              return;
            }
            try {
              const uid = await registerSchema(name as never);
              appContext.notify("success", `${name} registered as ${uid}.`);
              await appContext.rerender();
            } catch (error) {
              appContext.notify("error", error instanceof Error ? error.message : "Schema registration failed.");
            }
          });
        });
      }
    };
  }

  const queue = await loadReviewQueue(15);
  const queueRows = queue.length
    ? queue
        .map(({ bundle, reviewState }) => {
          const href = context.router.href(`/report/${bundle.publicSubmission.reportHash}`);
          return `
            <tr>
              <td><a href="${href}" data-nav>${escapeHtml(bundle.publicSubmission.reportId)}</a></td>
              <td>${escapeHtml(formatDate(bundle.publicSubmission.createdAt))}</td>
              <td>${escapeHtml(bundle.publicSubmission.targetKind)}</td>
              <td>${escapeHtml(bundle.publicSubmission.disclosureMode)}</td>
              <td>${escapeHtml(reviewState.headline?.validity ?? "pending")}</td>
              <td>${escapeHtml(bundle.publicSubmission.publicSummary)}</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="6" class="muted-cell">No report queue items resolved yet.</td></tr>`;

  return {
    title: "Review Queue",
    html: `
      <section class="panel">
        <div class="panel-title">[ reviewer queue ]</div>
        <p class="lede">Connected reviewer: ${escapeHtml(authController.getSession().address ?? "-")}</p>
        <p class="helper-copy">bug index: ${escapeHtml(chainConfig.bugIndexAddress || "unset")}</p>
        <p class="helper-copy">bond vault: ${escapeHtml(chainConfig.bugBondVaultAddress)}</p>
        <p class="helper-copy">treasury vault: ${escapeHtml(chainConfig.bugTreasuryVaultAddress)}</p>
        <table class="data-table">
          <thead>
            <tr>
              <th>report</th>
              <th>created</th>
              <th>target</th>
              <th>mode</th>
              <th>trusted state</th>
              <th>summary</th>
            </tr>
          </thead>
          <tbody>${queueRows}</tbody>
        </table>
      </section>

      <section class="panel">
        <div class="panel-title">[ schema catalog ]</div>
        <table class="data-table compact-table">
          <thead><tr><th>schema</th><th>uid</th><th>definition</th><th>action</th></tr></thead>
          <tbody>${schemaRows}</tbody>
        </table>
      </section>
    `,
    afterRender: (root, appContext) => {
      root.querySelectorAll<HTMLButtonElement>("[data-register-schema]").forEach((button) => {
        button.addEventListener("click", async () => {
          const name = button.dataset.registerSchema;
          if (!name) {
            return;
          }
          try {
            const uid = await registerSchema(name as never);
            appContext.notify("success", `${name} registered as ${uid}.`);
            await appContext.rerender();
          } catch (error) {
            appContext.notify("error", error instanceof Error ? error.message : "Schema registration failed.");
          }
        });
      });
    }
  };
};
