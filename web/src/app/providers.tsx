"use client";

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "@/lib/api";

// One QueryClient per browser tab. It caches API responses and handles polling.
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => {
    // If the session expires while a screen is open, any call answers 401.
    // Marking the user as logged out makes AppShell send them to /login.
    const onError = (error: Error) => {
      if (error instanceof ApiError && error.status === 401) {
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
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
