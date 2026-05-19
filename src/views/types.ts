import type { AppNotice } from "../types/domain";
import type { RouteMatch, SessionState } from "../types/app";
import type { AppRouter } from "../router";
import type { StorageProvider } from "../types/storage";
import type { ContractOwnerAccess } from "../contracts/cheapbugsSuite";

export type ContractOwnerViewState =
  | { status: "idle"; address: null }
  | { status: "loading"; address: `0x${string}`; requestId: number }
  | { status: "ready"; address: `0x${string}`; access: ContractOwnerAccess }
  | { status: "error"; address: `0x${string}`; errorMessage: string };

export type AppViewContext = {
  route: RouteMatch;
  session: SessionState;
  ownerAccess: ContractOwnerViewState;
  router: AppRouter;
  storage: StorageProvider;
  notices: AppNotice[];
  notify: (tone: AppNotice["tone"], message: string) => void;
  dismissNotice: (id: string) => void;
  rerender: () => Promise<void>;
};

export type ViewResult = {
  title: string;
  html: string;
  afterRender?: (root: HTMLElement, context: AppViewContext) => Promise<void> | void;
};
