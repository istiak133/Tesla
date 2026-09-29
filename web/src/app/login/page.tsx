"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthLayout } from "@/components/auth-layout";
import { Button, ErrorNote, Field, inputClass } from "@/components/ui";
import { api } from "@/lib/api";
import { homeFor } from "@/lib/session";
import type { User } from "@/lib/types";

// The seeded story cast (see the README). Clicking one fills the form.
const DEMO_ACCOUNTS = [
  { name: "Jashim", email: "jashim@teslapool.test", role: "Driver" },
  { name: "Nusrat", email: "nusrat@teslapool.test", role: "Passenger" },
  { name: "Rafiq", email: "rafiq@teslapool.test", role: "Passenger" },
  { name: "Shirin", email: "shirin@teslapool.test", role: "Passenger" },
];
const DEMO_PASSWORD = "tesla1234";

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: () =>
      api<User>("/auth/login", { method: "POST", body: { email, password } }),
    onSuccess: (user) => {
      queryClient.setQueryData(["me"], user);
      router.replace(homeFor(user));
    },
  });

  return (
    <AuthLayout title="Log in" subtitle="Welcome back.">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          login.mutate();
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
        <Button type="submit" className="w-full" loading={login.isPending}>
          Log in
        </Button>
      </form>

      <div className="mt-6 border-t border-zinc-100 pt-5">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Demo accounts
        </p>
        <div className="grid grid-cols-2 gap-2">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              onClick={() => {
                setEmail(account.email);
                setPassword(DEMO_PASSWORD);
              }}
              className="rounded-lg border border-zinc-200 px-3 py-2 text-left transition hover:border-zinc-400"
            >
              <span className="block text-sm font-medium">{account.name}</span>
              <span className="block text-xs text-zinc-500">
                {account.role}
              </span>
            </button>
          ))}
        </div>
      </div>

      <p className="mt-6 text-center text-sm text-zinc-500">
        New passenger?{" "}
        <Link href="/signup" className="font-medium text-zinc-900 underline">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  );
}
