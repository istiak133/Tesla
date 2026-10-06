"use client";

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "@/lib/api";
import { LiveUpdates } from "@/lib/live";

// One QueryClient per browser tab. It caches API responses and handles polling.
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => {
    // If the session expires while a screen is open, any call answers 401.
    // Marking the user as logged out makes AppShell send them to /login. Everything else that
    // was cached for them is dropped too: on a shared phone the next person to log in in this
    // tab must never see the previous user's ride or history, even for a moment.
    const onError = (error: Error) => {
      if (error instanceof ApiError && error.status === 401) {
        client.removeQueries({
          predicate: (query) => query.queryKey[0] !== "me",
        });
        client.setQueryData(["me"], null);
      }
    };
    const client: QueryClient = new QueryClient({
      queryCache: new QueryCache({ onError }),
      mutationCache: new MutationCache({ onError }),
      defaultOptions: {
        // A 401 will not fix itself, so it is not retried.
        queries: {
          retry: (failureCount, error) =>
            !(error instanceof ApiError && error.status === 401) &&
            failureCount < 1,
          refetchOnWindowFocus: true,
        },
      },
    });
    return client;
  });
  return (
    <QueryClientProvider client={queryClient}>
      <LiveUpdates>{children}</LiveUpdates>
    </QueryClientProvider>
  );
}
