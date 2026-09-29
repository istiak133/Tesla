import Link from "next/link";
import { SiteFooter, SiteHeader } from "./site-chrome";

// Centered card used by the login and sign-up pages.
export function AuthLayout({
  title,
  subtitle,
  wide = false,
  children,
}: {
  title: string;
  subtitle: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader
        right={
          <nav className="flex shrink-0 items-center gap-1 whitespace-nowrap text-sm">
            <Link
              href="/login"
              className="rounded-lg px-3 py-1.5 text-stone-300 transition hover:text-cream"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-cream px-3 py-1.5 font-medium text-ink transition hover:bg-paper"
            >
              Sign up
            </Link>
          </nav>
        }
      />
      <main className="flex flex-1 items-start justify-center px-5 py-12">
        <div className={`w-full ${wide ? "max-w-xl" : "max-w-md"}`}>
          <div className="rounded-2xl border border-stone-200 bg-paper p-5 sm:p-7 shadow-[0_1px_2px_rgba(23,20,17,0.04),0_12px_32px_-12px_rgba(23,20,17,0.12)]">
            <h1 className="font-display text-3xl tracking-tight">{title}</h1>
            <p className="mt-1 text-sm text-stone-500">{subtitle}</p>
            <div className="mt-6">{children}</div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
