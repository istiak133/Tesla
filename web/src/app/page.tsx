"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loading, ErrorNote } from "@/components/ui";
import { homeFor, useSession } from "@/lib/session";

// "/" only decides where to go: the login page, or the user's own home.
export default function Home() {
  const router = useRouter();
  const session = useSession();

  useEffect(() => {
    if (session.isPending || session.isError) return;
    router.replace(session.data ? homeFor(session.data) : "/login");
  }, [session.isPending, session.isError, session.data, router]);

  return (
    <main className="mx-auto max-w-md px-5 py-20">
      {session.isError ? (
        <ErrorNote message="The server is not reachable. It may be waking up; please refresh in a moment." />
      ) : (
        <Loading label="Opening Dhaka Tesla Pool…" />
      )}
    </main>
  );
}
