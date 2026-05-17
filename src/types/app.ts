import type { AppNotice } from "./domain";

export type RouteName = "home" | "submit" | "report" | "review" | "token" | "patrons" | "login";

export type RouteMatch = {
  name: RouteName;
  path: string;
  params: Record<string, string>;
};

export type SessionState = {
  status: "idle" | "loading" | "connected" | "error";
  walletId: string | null;
  address: `0x${string}` | null;
  mode: "injected" | "walletconnect" | "local" | null;
  ensName: string | null;
  ensAvatarUrl: string | null;
  ensLookupStatus: "idle" | "loading" | "resolved" | "missing" | "error";
  siweMessage: string | null;
  siweSignature: `0x${string}` | null;
  siweIssuedAt: string | null;
  isReviewer: boolean;
  lastError: string | null;
};

export type AppState = {
  route: RouteMatch;
  session: SessionState;
  notices: AppNotice[];
};
