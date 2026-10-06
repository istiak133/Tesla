"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { homeFor, useLogout, useSession } from "@/lib/session";
import type { Role, User } from "@/lib/types";
import { SiteFooter, SiteHeader } from "./site-chrome";
import { Button, ErrorNote, Loading } from "./ui";

/**
 * Page frame for logged-in screens. Sends visitors to /login if they are not logged in,
 * and to their own home if they open the other role's page.
 */
export function AppShell({
  role,
  children,
}: {
  role: Role;
  children: (user: User) => React.ReactNode;
}) {
  const router = useRouter();
  const session = useSession();
  const logout = useLogout();
  const user = session.data;

  useEffect(() => {
    if (session.isPending) return;
    if (user === null) router.replace("/login");
    else if (user && user.role !== role) router.replace(homeFor(user));
  }, [session.isPending, user, role, router]);

  return (
    <>
      <SiteHeader
        right={
          user && (
            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="text-sm font-medium">{user.name}</p>
                <p className="text-xs text-stone-400">
                  {user.role === "DRIVER" ? "Driver" : "Passenger"}
                </p>
              </div>
              <Button
                variant="onDark"
                loading={logout.isPending}
                onClick={() => logout.mutate()}
              >
                Log out
              </Button>
            </div>
          )
        }
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8">
        {session.isError ? (
          // Not a 401 (that is "logged out"): the server or the network failed, for example
          // while the API is waking up. Say so and offer a retry instead of spinning.
          <div className="mx-auto max-w-md space-y-4 py-10 text-center">
            <ErrorNote message={session.error.message} />
            <Button
              loading={session.isFetching}
              onClick={() => void session.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : session.isPending || !user || user.role !== role ? (
          <Loading label="Loading your account…" />
        ) : (
          children(user)
        )}
      </main>
      <SiteFooter />
    </>
  );
}
