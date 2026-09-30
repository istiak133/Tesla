import Link from "next/link";
import { SiteFooter, SiteHeader } from "./site-chrome";

// Login and sign-up: the brand on the left, the form on the right (stacked on phones).
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
      <main className="mx-auto grid w-full max-w-6xl flex-1 items-start gap-10 px-5 py-10 lg:grid-cols-[1.1fr_1fr] lg:py-14">
        <section className="lg:sticky lg:top-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
            Dhaka Tesla Pool
          </p>
          <h2 className="mt-3 font-display text-5xl leading-[1.02] tracking-tight sm:text-6xl">
            Share a seat.
            <br />
            Split the fare.
          </h2>
          <p className="mt-4 max-w-md text-base text-stone-600">
            Battery Teslas on fixed routes across Dhaka. Hop on at any stop
            ahead, ride with others going your way, and pay 20% less.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/bullet-logo-900.png"
            alt="Bullet: three seat, battery powered Tesla"
            width={900}
            height={900}
            className="mt-6 hidden w-full max-w-[420px] rounded-2xl lg:block"
          />
          <ul className="mt-6 grid max-w-md gap-2 text-sm sm:grid-cols-3 lg:mt-2">
            {[
              ["6 routes", "across the city, both ways"],
              ["3 seats", "shared, never overbooked"],
              ["Live", "updates in seconds"],
            ].map(([big, small]) => (
              <li
                key={big}
                className="rounded-xl border border-stone-200 bg-paper px-3 py-2.5"
              >
                <span className="block font-display text-xl leading-none">
                  {big}
                </span>
                <span className="mt-1 block text-xs text-stone-500">
                  {small}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <div
          className={`w-full ${wide ? "max-w-xl" : "max-w-md"} lg:justify-self-end`}
        >
          <div className="rounded-2xl border border-stone-200 bg-paper p-5 shadow-[0_1px_2px_rgba(23,20,17,0.04),0_18px_40px_-16px_rgba(23,20,17,0.18)] sm:p-7">
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
