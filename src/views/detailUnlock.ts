import {
  approveTreasuryForDetailKeyPayment,
  getTreasuryDetailKeyAllowance,
  purchaseDetailKey
} from "../contracts/treasuryVault";
import { saveReportAccessKey } from "../lib/report-access";
import { formatTokenAmount, shortHash } from "../lib/utils";
import { isWalletActionCancelled } from "../lib/walletAction";
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
        setUnlockStatus("wallet required", "Connect a wallet before unlocking early access.");
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
          `${priceLabel} to unlock ${quote.daysRemaining} day${quote.daysRemaining === 1 ? "" : "s"} of early access.`
        );
        setUnlockActions(`
          <button id="confirm-detail-unlock" class="button" type="button">unlock early access</button>
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
            setUnlockStatus("checking BUGZ approval", "checking treasury allowance before payment.");
            const allowance = await getTreasuryDetailKeyAllowance(buyer);
            let skipPaymentAllowancePreflight = false;
            if (allowance < quote.priceWei) {
              setUnlockStatus("approving BUGZ", `Approve ${priceLabel} for the treasury vault before payment.`);
              const approval = await appContext.runWalletAction(
                {
                  title: "approve detail payment",
                  message:
                    "Approve the BUGZ treasury allowance transaction in your wallet. CheapBugs will wait for Base confirmation after signing."
                },
                () => approveTreasuryForDetailKeyPayment(quote.priceWei)
              );
              if (approval.txHash) {
                skipPaymentAllowancePreflight = true;
                setUnlockStatus(
                  "BUGZ approval confirmed",
                  `approval confirmed: ${shortHash(approval.txHash, 12, 8)}. Continuing to payment.`
                );
              }
            } else {
              setUnlockStatus("BUGZ approval ready", "Existing BUGZ treasury approval is enough for this unlock.");
            }
            setUnlockStatus("paying treasury", "sending the detail-key payment to the treasury vault.");
            const payment = await appContext.runWalletAction(
              {
                title: "pay treasury",
                message:
                  "Approve the detail-key payment transaction in your wallet. CheapBugs will wait for Base confirmation after signing."
              },
              () =>
                purchaseDetailKey(reportHash, quote.priceWei, {
                  skipAllowancePreflight: skipPaymentAllowancePreflight
                })
            );
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
            if (isWalletActionCancelled(error)) {
              setUnlockStatus("wallet request cancelled", "Reject any remaining wallet prompt if it is still open.");
              setUnlockActions(`<button id="close-detail-unlock" class="button secondary" type="button">close</button>`);
              root.querySelector<HTMLButtonElement>("#close-detail-unlock")?.addEventListener("click", closeUnlockModal);
              return;
            }
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
