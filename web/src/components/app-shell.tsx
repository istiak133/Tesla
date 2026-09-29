"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { homeFor, useLogout, useSession } from "@/lib/session";
import type { Role, User } from "@/lib/types";
import { Button, Loading } from "./ui";

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
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
          <div>
            <p className="text-base font-semibold tracking-tight">
              Dhaka Tesla Pool
            </p>
            <p className="text-xs text-zinc-500">
              Share a seat. Split the fare.
            </p>
          </div>
          {user && (
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-sm font-medium">{user.name}</p>
                <p className="text-xs text-zinc-500">
                  {user.role === "DRIVER" ? "Driver" : "Passenger"}
                </p>
              </div>
              <Button
                variant="secondary"
                loading={logout.isPending}
                onClick={() => logout.mutate()}
              >
                Log out
              </Button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8">
        {session.isPending || !user || user.role !== role ? (
          <Loading label="Loading your account…" />
        ) : (
          children(user)
        )}
      </main>
    </div>
  );
}
