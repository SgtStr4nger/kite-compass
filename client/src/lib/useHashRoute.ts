import { useSyncExternalStore, useCallback } from "react";

// A hash-location hook (wouter-compatible) that keeps the query string OUT of
// the path used for route matching, but preserves it in the URL. This lets us
// use links like `#/results?month=July` while `<Route path="/results">` matches.

function currentHashPath(): string {
  const hash = window.location.hash.replace(/^#/, "");
  const q = hash.indexOf("?");
  const path = q >= 0 ? hash.slice(0, q) : hash;
  return path || "/";
}

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

export function useHashRoute(): [string, (to: string, opts?: { replace?: boolean }) => void] {
  const path = useSyncExternalStore(subscribe, currentHashPath, () => "/");

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    const target = "#" + (to.startsWith("/") ? to : "/" + to);
    if (opts?.replace) {
      const url = window.location.href.split("#")[0] + target;
      window.history.replaceState(null, "", url);
      // replaceState does not fire hashchange; dispatch manually so subscribers update.
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    } else {
      window.location.hash = target;
    }
  }, []);

  return [path, navigate];
}
