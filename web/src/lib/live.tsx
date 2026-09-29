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

/** Opens one event stream while someone is logged in. The browser reconnects by itself. */
export function LiveUpdates({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const loggedIn = Boolean(useSession().data);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!loggedIn) return;
    const source = new EventSource("/api/events/stream");
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener("change", (event) => {
      const { topics } = JSON.parse((event as MessageEvent<string>).data) as {
        topics: string[];
      };
      for (const topic of topics) {
        for (const queryKey of REFRESH[topic] ?? []) {
          queryClient.invalidateQueries({ queryKey });
        }
      }
    });
    return () => {
      source.close();
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
