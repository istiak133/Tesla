"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthLayout } from "@/components/auth-layout";
import { ChosenRole, ROLE_NAME, RolePicker } from "@/components/role-picker";
import { Button, ErrorNote, Field, inputClass } from "@/components/ui";
import { api } from "@/lib/api";
import { homeFor } from "@/lib/session";
import type { IdDocumentType, Role, User } from "@/lib/types";

// Sign-up for both kinds of user (D-015). The API tidies and checks every value again.
const EMPTY = {
  name: "",
  email: "",
  phone: "",
  password: "",
  presentAddress: "",
  permanentAddress: "",
  idNumber: "",
  licenceNumber: "",
  vehicleName: "",
  plateNumber: "",
};

export default function SignupPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [role, setRole] = useState<Role | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [idType, setIdType] = useState<IdDocumentType>("NID");
  const [sameAddress, setSameAddress] = useState(false);

  const set =
    (key: keyof typeof EMPTY) => (event: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [key]: event.target.value });

  const signup = useMutation({
    mutationFn: (as: Role) => {
      const common = {
        name: form.name,
        email: form.email,
        phone: form.phone,
        password: form.password,
        presentAddress: form.presentAddress,
        permanentAddress: sameAddress
          ? form.presentAddress
          : form.permanentAddress,
      };
      return as === "DRIVER"
        ? api<User>("/auth/signup/driver", {
            method: "POST",
            body: {
              ...common,
              idType,
              idNumber: form.idNumber,
              licenceNumber: form.licenceNumber,
              vehicleName: form.vehicleName,
              plateNumber: form.plateNumber,
            },
          })
        : api<User>("/auth/signup/passenger", { method: "POST", body: common });
    },
    onSuccess: (user) => {
      queryClient.setQueryData(["me"], user);
      router.replace(homeFor(user));
    },
  });

  return (
    <AuthLayout
      title="Create an account"
      subtitle={
        role
          ? role === "DRIVER"
            ? "Your details, your documents and your Tesla."
            : "A few details and you can book your first seat."
          : "First, choose your account type."
      }
      wide={role !== null}
    >
      {role === null ? (
        <RolePicker
          onPick={(next) => {
            setRole(next);
            signup.reset();
          }}
        />
      ) : (
        <>
          <ChosenRole role={role} onChange={() => setRole(null)} />
          <form
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault();
              signup.mutate(role);
            }}
          >
            <Section title="About you">
              <Field label="Full name">
                <input
                  className={inputClass}
                  autoComplete="name"
                  required
                  minLength={2}
                  value={form.name}
                  onChange={set("name")}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Email">
                  <input
                    className={inputClass}
                    type="email"
                    autoComplete="email"
                    required
                    value={form.email}
                    onChange={set("email")}
                  />
                </Field>
                <Field label="Mobile number">
                  <input
                    className={inputClass}
                    type="tel"
                    autoComplete="tel"
                    placeholder="01712 345678"
                    required
                    value={form.phone}
                    onChange={set("phone")}
                  />
                </Field>
              </div>
              <Field label="Password (at least 8 characters)">
                <input
                  className={inputClass}
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={form.password}
                  onChange={set("password")}
                />
              </Field>
            </Section>

            <Section title="Address">
              <Field label="Present address">
                <input
                  className={inputClass}
                  autoComplete="street-address"
                  placeholder="House, road, area, Dhaka"
                  required
                  minLength={5}
                  value={form.presentAddress}
                  onChange={set("presentAddress")}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm text-stone-600">
                <input
                  type="checkbox"
                  className="accent-ink"
                  checked={sameAddress}
                  onChange={(event) => setSameAddress(event.target.checked)}
                />
                Permanent address is the same
              </label>
              {!sameAddress && (
                <Field label="Permanent address">
                  <input
                    className={inputClass}
                    placeholder="Village or area, district"
                    required
                    minLength={5}
                    value={form.permanentAddress}
                    onChange={set("permanentAddress")}
                  />
                </Field>
              )}
            </Section>

            {role === "DRIVER" && (
              <>
                <Section title="Identity and licence">
                  <div>
                    <span className="mb-1.5 block text-sm font-medium text-stone-700">
                      Identity document
                    </span>
                    <div className="inline-flex rounded-lg border border-stone-300 p-0.5">
                      {(["NID", "PASSPORT"] as const).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setIdType(type)}
                          className={`rounded-md px-3 py-1 text-sm transition ${idType === type ? "bg-ink text-cream" : "text-stone-600 hover:text-ink"}`}
                        >
                          {type === "NID" ? "National ID" : "Passport"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label={
                        idType === "NID" ? "NID number" : "Passport number"
                      }
                    >
                      <input
                        className={inputClass}
                        placeholder={
                          idType === "NID" ? "10, 13 or 17 digits" : "A01234567"
                        }
                        required
                        value={form.idNumber}
                        onChange={set("idNumber")}
                      />
                    </Field>
                    <Field label="Driving licence number">
                      <input
                        className={inputClass}
                        placeholder="DK0123456C00001"
                        required
                        value={form.licenceNumber}
                        onChange={set("licenceNumber")}
                      />
                    </Field>
                  </div>
                </Section>

                <Section title="Your Tesla">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Car name">
                      <input
                        className={inputClass}
                        placeholder="e.g. Bullet"
                        required
                        minLength={2}
                        value={form.vehicleName}
                        onChange={set("vehicleName")}
                      />
                    </Field>
                    <Field label="Number plate">
                      <input
                        className={inputClass}
                        placeholder="DHAKA METRO-GA 12-3456"
                        required
                        value={form.plateNumber}
                        onChange={set("plateNumber")}
                      />
                    </Field>
                  </div>
                  <p className="text-xs text-stone-500">
                    Every car in the pool offers 3 passenger seats. You choose
                    your location and route on the driver page.
                  </p>
                </Section>
              </>
            )}

            {signup.isError && <ErrorNote message={signup.error.message} />}
            <Button type="submit" className="w-full" loading={signup.isPending}>
              Create {ROLE_NAME[role].toLowerCase()} account
            </Button>
          </form>
        </>
      )}
      <p className="mt-6 text-center text-sm text-stone-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-ink underline">
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-500">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}
