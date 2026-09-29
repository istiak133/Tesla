"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthLayout } from "@/components/auth-layout";
import { Button, ErrorNote, Field, inputClass } from "@/components/ui";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";

// Passenger sign-up. Drivers are created by the seed data.
export default function SignupPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const signup = useMutation({
    mutationFn: () =>
      api<User>("/auth/signup", {
        method: "POST",
        body: { name, email, password },
      }),
    onSuccess: (user) => {
      queryClient.setQueryData(["me"], user);
      router.replace("/ride");
    },
  });

  return (
    <AuthLayout title="Create an account" subtitle="For passengers.">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          signup.mutate();
        }}
      >
        <Field label="Name">
          <input
            className={inputClass}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
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
        <Field label="Password (at least 8 characters)">
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        {signup.isError && <ErrorNote message={signup.error.message} />}
        <Button type="submit" className="w-full" loading={signup.isPending}>
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-zinc-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-zinc-900 underline">
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
