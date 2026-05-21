export type WalletActionOptions = {
  title: string;
  message: string;
};

export class WalletActionCancelledError extends Error {
  constructor(message = "Wallet request cancelled.") {
    super(message);
    this.name = "WalletActionCancelledError";
  }
}

export const isWalletActionCancelled = (error: unknown): error is WalletActionCancelledError =>
  error instanceof WalletActionCancelledError ||
  (error instanceof Error && error.name === "WalletActionCancelledError");
