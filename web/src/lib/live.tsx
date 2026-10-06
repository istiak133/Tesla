"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState } from "react";
import { useSession } from "./session";

// Live updates (decision D-020). The API sends a hint over Server-Sent Events whenever a
// request or a ride changes; each hint refreshes the screens that show it. The hint never
// carries data: every screen fetches its own data through the normal endpoints.
const REFRESH: Record<string, string[][]> = {
  requests: [["driver-requests"], ["route-suggestions"]],
  rides: [
    ["current-ride"],
    ["ride-history"],
    ["driver-state"],
    ["driver-trips"],
    ["driver-requests"],
  ],
};

const LiveContext = createContext(false);

// The server sends a ping every 25 s. A minute of silence means the connection died without
// an error event (a proxy can leave it half open).
const SILENCE_MS = 60_000;
const MAX_RETRY_MS = 30_000;

/**
 * Opens one event stream while someone is logged in, and keeps it open: the browser retries
 * by itself after a dropped connection, but not after a non-200 answer (a 502 while the API
 * restarts, a 401), and never notices a half-open one; both are handled here.
 */
export function LiveUpdates({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const loggedIn = Boolean(useSession().data);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!loggedIn) return;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let lastHeard = Date.now();

    // Hints sent while the stream was down are lost: on (re)connecting, refresh everything.
    const refreshAll = () => {
      for (const keys of Object.values(REFRESH)) {
        for (const queryKey of keys) {
          queryClient.invalidateQueries({ queryKey });
        }
      }
    };

    const connect = () => {
      source = new EventSource("/api/events/stream");
      lastHeard = Date.now();
      source.onopen = () => {
        attempt = 0;
        lastHeard = Date.now();
        setConnected(true);
        refreshAll();
      };
      source.onerror = () => {
        setConnected(false);
        if (source?.readyState === EventSource.CLOSED) {
          reopen();
        }
      };
      source.addEventListener("ping", () => {
        lastHeard = Date.now();
      });
      source.addEventListener("change", (event) => {
        lastHeard = Date.now();
        const { topics } = JSON.parse((event as MessageEvent<string>).data) as {
          topics: string[];
        };
        for (const topic of topics) {
          for (const queryKey of REFRESH[topic] ?? []) {
            queryClient.invalidateQueries({ queryKey });
          }
        }
      });
    };

    // A new stream after a wait that doubles each time (1 s … 30 s). Screens poll every few
    // seconds meanwhile, so nothing is missed, only slower.
    const reopen = () => {
      source?.close();
      source = null;
      setConnected(false);
      if (retry !== null) return;
      // A 401 means the session ended: the session check then sends the user to log in.
      queryClient.invalidateQueries({ queryKey: ["me"] });
      const delay = Math.min(MAX_RETRY_MS, 1_000 * 2 ** attempt);
      attempt++;
      retry = setTimeout(() => {
        retry = null;
        connect();
      }, delay);
    };

    const watchdog = setInterval(() => {
      if (source !== null && Date.now() - lastHeard > SILENCE_MS) {
        reopen();
      }
    }, 15_000);

    connect();
    return () => {
      clearInterval(watchdog);
      if (retry !== null) clearTimeout(retry);
      source?.close();
      setConnected(false);
    };
  }, [loggedIn, queryClient]);

  return (
    <LiveContext.Provider value={connected}>{children}</LiveContext.Provider>
  );
}

/**
 * How often a screen polls: its usual pace while the live stream is down, and only a slow
 * safety net (30 s) while it is up, because changes then arrive as they happen.
 */
export function useRefreshInterval(usualMs: number): number {
  return useContext(LiveContext) ? Math.max(usualMs, 30_000) : usualMs;
}
