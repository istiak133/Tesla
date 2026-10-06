"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthLayout } from "@/components/auth-layout";
import { ChosenRole, ROLE_NAME, RolePicker } from "@/components/role-picker";
import { Button, ErrorNote, Field, inputClass } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { homeFor } from "@/lib/session";
import type { Role, User } from "@/lib/types";

// The seeded story cast (see the README). Clicking one fills the form.
const DEMO_ACCOUNTS: { name: string; email: string; role: Role }[] = [
  { name: "Jashim", email: "jashim@teslapool.test", role: "DRIVER" },
  { name: "Nusrat", email: "nusrat@teslapool.test", role: "PASSENGER" },
  { name: "Rafiq", email: "rafiq@teslapool.test", role: "PASSENGER" },
  { name: "Shirin", email: "shirin@teslapool.test", role: "PASSENGER" },
];
const DEMO_PASSWORD = "tesla1234";

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [role, setRole] = useState<Role | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: (as: Role) =>
      api<User>("/auth/login", {
        method: "POST",
        body: { role: as, email, password },
      }),
    onSuccess: (user) => {
      // A new user in this tab: nothing cached for an earlier one may show.
      queryClient.removeQueries();
      queryClient.setQueryData(["me"], user);
      router.replace(homeFor(user));
    },
  });

  // Right password, other account type: offer the switch in one tap.
  const otherRole: Role | null =
    login.error instanceof ApiError &&
    login.error.code === "WRONG_ACCOUNT_TYPE" &&
    role !== null
      ? role === "DRIVER"
        ? "PASSENGER"
        : "DRIVER"
      : null;

  const pick = (next: Role | null) => {
    setRole(next);
    login.reset();
  };

  return (
    <AuthLayout
      title="Log in"
      subtitle={
        role
          ? `Welcome back. Log in to your ${ROLE_NAME[role].toLowerCase()} account.`
          : "First, choose your account type."
      }
    >
      {role === null ? (
        <RolePicker onPick={pick} />
      ) : (
        <>
          <ChosenRole role={role} onChange={() => pick(null)} />
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              login.mutate(role);
            }}
          >
            <Field label="Email">
              <input
                className={inputClass}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field label="Password">
              <input
                className={inputClass}
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            {login.isError && <ErrorNote message={login.error.message} />}
            {otherRole && (
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => {
                  setRole(otherRole);
                  login.mutate(otherRole);
                }}
              >
                Log in as {ROLE_NAME[otherRole].toLowerCase()} instead
              </Button>
            )}
            <Button type="submit" className="w-full" loading={login.isPending}>
              Log in
            </Button>
          </form>

          <div className="mt-6 border-t border-stone-200 pt-5">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-stone-500">
              Demo {ROLE_NAME[role].toLowerCase()} accounts
            </p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.filter((account) => account.role === role).map(
                (account) => (
                  <button
                    key={account.email}
                    type="button"
                    onClick={() => {
                      setEmail(account.email);
                      setPassword(DEMO_PASSWORD);
                    }}
                    className="rounded-lg border border-stone-200 px-3 py-2 text-left transition hover:border-stone-400"
                  >
                    <span className="block text-sm font-medium">
                      {account.name}
                    </span>
                    <span className="block text-xs text-stone-500">
                      {account.email}
                    </span>
                  </button>
                ),
              )}
            </div>
          </div>
        </>
      )}

      <p className="mt-6 text-center text-sm text-stone-500">
        New here?{" "}
        <Link href="/signup" className="font-medium text-ink underline">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  );
}
