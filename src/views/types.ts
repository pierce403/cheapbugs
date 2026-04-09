import type { AppNotice } from "../types/domain";
import type { RouteMatch, SessionState } from "../types/app";
import type { AppRouter } from "../router";
import type { StorageProvider } from "../types/storage";

export type AppViewContext = {
  route: RouteMatch;
  session: SessionState;
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
