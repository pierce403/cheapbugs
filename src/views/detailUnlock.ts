import { approveTreasuryForDetailKeyPayment, purchaseDetailKey } from "../contracts/treasuryVault";
import { saveReportAccessKey } from "../lib/report-access";
import { escapeHtml, formatTokenAmount, shortHash } from "../lib/utils";
import { authController } from "../services";
import { confirmDetailUnlockPayment, requestDetailUnlockQuote } from "../xmtp/broker";

import type { AppViewContext } from "./types";

const MODAL_ID = "detail-unlock-modal";
const TITLE_ID = "detail-unlock-title";
const STATUS_ID = "detail-unlock-status";
const ACTIONS_ID = "detail-unlock-actions";

export const renderDetailUnlockModal = (): string => `
  <div id="${MODAL_ID}" class="processing-modal-backdrop" hidden role="dialog" aria-modal="true" aria-label="detail unlock">
    <div class="panel processing-modal detail-unlock-modal">
      <div class="signature-spinner" aria-hidden="true"></div>
      <div class="signature-modal-copy">
        <strong id="${TITLE_ID}">detail unlock</strong>
        <p id="${STATUS_ID}">waiting for broker quote.</p>
        <div id="${ACTIONS_ID}" class="modal-actions"></div>
      </div>
    </div>
  </div>
`;

export const bindDetailUnlockFlow = (root: HTMLElement, appContext: AppViewContext): void => {
  const unlockModal = root.querySelector<HTMLDivElement>(`#${MODAL_ID}`);
  const unlockTitle = root.querySelector<HTMLElement>(`#${TITLE_ID}`);
  const unlockStatus = root.querySelector<HTMLElement>(`#${STATUS_ID}`);
  const unlockActions = root.querySelector<HTMLDivElement>(`#${ACTIONS_ID}`);

  if (!unlockModal || !unlockTitle || !unlockStatus || !unlockActions) {
    return;
  }

  const setUnlockStatus = (title: string, message: string): void => {
    unlockTitle.textContent = title;
    unlockStatus.textContent = message;
  };

  const setUnlockActions = (html: string): void => {
    unlockActions.innerHTML = html;
  };

  const openUnlockModal = (): void => {
    unlockModal.removeAttribute("hidden");
  };

  const closeUnlockModal = (): void => {
    unlockModal.setAttribute("hidden", "");
    setUnlockActions("");
  };

  unlockModal.addEventListener("click", (event) => {
    if (event.target === unlockModal) {
      closeUnlockModal();
    }
  });

  root.querySelectorAll<HTMLButtonElement>("[data-detail-unlock-report]").forEach((unlockButton) => {
    unlockButton.addEventListener("click", async () => {
      const reportHash = unlockButton.dataset.detailUnlockReport as `0x${string}` | undefined;
      if (!reportHash) {
        return;
      }

      openUnlockModal();
      setUnlockActions("");

      const identity = authController.getXmtpIdentity();
      const buyer = appContext.session.address;
      if (!buyer || !identity) {
        setUnlockStatus("wallet required", "Connect a wallet before buying detail access.");
        setUnlockActions(`
          <button id="connect-detail-unlock-wallet" class="button" type="button">connect wallet</button>
          <button id="close-detail-unlock" class="button secondary" type="button">close</button>
        `);
        root.querySelector<HTMLButtonElement>("#connect-detail-unlock-wallet")?.addEventListener("click", () => {
          closeUnlockModal();
          appContext.openWalletOnboarding();
        });
        root.querySelector<HTMLButtonElement>("#close-detail-unlock")?.addEventListener("click", closeUnlockModal);
        return;
      }

      if (identity.address.toLowerCase() !== buyer.toLowerCase()) {
        setUnlockStatus("wallet mismatch", "XMTP identity does not match the connected wallet.");
        setUnlockActions(`<button id="close-detail-unlock" class="button secondary" type="button">close</button>`);
        root.querySelector<HTMLButtonElement>("#close-detail-unlock")?.addEventListener("click", closeUnlockModal);
        return;
      }

      setUnlockStatus("detail unlock", "asking the broker for a report-specific price.");
      try {
        const quote = await requestDetailUnlockQuote(identity, reportHash, (message) =>
          setUnlockStatus("detail unlock", message)
        );
        const priceLabel = `${formatTokenAmount(quote.priceWei, 18)} BUGZ`;
        setUnlockStatus(
          "detail unlock quote",
          `${priceLabel} for ${quote.daysRemaining} day${quote.daysRemaining === 1 ? "" : "s"} of early access.`
        );
        setUnlockActions(`
          <button id="confirm-detail-unlock" class="button" type="button">yes, pay ${escapeHtml(priceLabel)}</button>
          <button id="cancel-detail-unlock" class="button secondary" type="button">cancel</button>
        `);
        root.querySelector<HTMLButtonElement>("#cancel-detail-unlock")?.addEventListener("click", closeUnlockModal);
        root.querySelector<HTMLButtonElement>("#confirm-detail-unlock")?.addEventListener("click", async () => {
          const confirmButton = root.querySelector<HTMLButtonElement>("#confirm-detail-unlock");
          if (confirmButton) {
            confirmButton.disabled = true;
          }
          setUnlockActions("");
          try {
            setUnlockStatus("approving BUGZ", "checking treasury allowance.");
            await approveTreasuryForDetailKeyPayment(quote.priceWei);
            setUnlockStatus("paying treasury", "sending the detail-key payment to the treasury vault.");
            const payment = await purchaseDetailKey(reportHash, quote.priceWei);
            setUnlockStatus("verifying payment", `payment confirmed: ${shortHash(payment.txHash, 12, 8)}. Asking broker for key.`);
            const key = await confirmDetailUnlockPayment(
              identity,
              {
                reportHash,
                requestId: quote.requestId,
                txHash: payment.txHash
              },
              (message) => setUnlockStatus("broker verification", message)
            );
            saveReportAccessKey(reportHash, key.detailsKey);
            appContext.notify("success", "Detail key saved locally for this report.");
            closeUnlockModal();
            await appContext.rerender();
          } catch (error) {
            setUnlockStatus("detail unlock failed", error instanceof Error ? error.message : "Detail unlock failed.");
            setUnlockActions(`<button id="close-detail-unlock" class="button secondary" type="button">close</button>`);
            root.querySelector<HTMLButtonElement>("#close-detail-unlock")?.addEventListener("click", closeUnlockModal);
          }
        });
      } catch (error) {
        setUnlockStatus("detail unlock failed", error instanceof Error ? error.message : "Broker quote failed.");
        setUnlockActions(`<button id="close-detail-unlock" class="button secondary" type="button">close</button>`);
        root.querySelector<HTMLButtonElement>("#close-detail-unlock")?.addEventListener("click", closeUnlockModal);
      }
    });
  });
};
