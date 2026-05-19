import { env } from "./config/env";
import type { RouteMatch } from "./types/app";

type RouteListener = (route: RouteMatch) => void;

const cleanPath = (rawPath: string): string => {
  const base = rawPath.split("?")[0]?.split("#")[0] || "/";
  const normalized = base.startsWith("/") ? base : `/${base}`;
  return normalized.replace(/\/+$/, "") || "/";
};

const matchRoute = (path: string): RouteMatch => {
  const normalized = cleanPath(path);

  if (normalized === "/") {
    return { name: "home", path: normalized, params: {} };
  }

  if (normalized === "/submit") {
    return { name: "submit", path: normalized, params: {} };
  }

  if (normalized === "/review") {
    return { name: "review", path: normalized, params: {} };
  }

  if (normalized === "/stake") {
    return { name: "stake", path: normalized, params: {} };
  }

  if (normalized === "/manage") {
    return { name: "manage", path: normalized, params: {} };
  }

  if (normalized === "/treasury") {
    return { name: "treasury", path: normalized, params: {} };
  }

  if (normalized === "/token") {
    return { name: "token", path: normalized, params: {} };
  }

  if (normalized === "/patrons") {
    return { name: "patrons", path: normalized, params: {} };
  }

  if (normalized === "/login") {
    return { name: "login", path: normalized, params: {} };
  }

  const reportMatch = normalized.match(/^\/report\/([^/]+)$/);
  if (reportMatch) {
    return {
      name: "report",
      path: normalized,
      params: {
        id: decodeURIComponent(reportMatch[1] ?? "")
      }
    };
  }

  const profileMatch = normalized.match(/^\/profile\/([^/]+)$/);
  if (profileMatch) {
    return {
      name: "profile",
      path: normalized,
      params: {
        address: decodeURIComponent(profileMatch[1] ?? "")
      }
    };
  }

  return { name: "home", path: "/", params: {} };
};

export class AppRouter {
  private listeners = new Set<RouteListener>();
  private current = matchRoute(this.currentPath());

  private currentPath(): string {
    if (env.routerMode === "hash") {
      const hashPath = window.location.hash.replace(/^#/, "");
      return hashPath || "/";
    }

    return `${window.location.pathname}${window.location.search}`;
  }

  private emit(): void {
    this.current = matchRoute(this.currentPath());
    this.listeners.forEach((listener) => listener(this.current));
  }

  start(): void {
    const eventName = env.routerMode === "hash" ? "hashchange" : "popstate";
    window.addEventListener(eventName, () => this.emit());
    this.emit();
  }

  subscribe(listener: RouteListener): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  navigate(path: string, replace = false): void {
    const normalized = cleanPath(path);
    if (env.routerMode === "hash") {
      const next = `#${normalized}`;
      if (replace) {
        window.location.replace(next);
      } else {
        window.location.hash = normalized;
      }
      return;
    }

    if (replace) {
      window.history.replaceState(null, "", normalized);
    } else {
      window.history.pushState(null, "", normalized);
    }
    this.emit();
  }

  href(path: string): string {
    const normalized = cleanPath(path);
    return env.routerMode === "hash" ? `#${normalized}` : normalized;
  }

  getRoute(): RouteMatch {
    return this.current;
  }
}
