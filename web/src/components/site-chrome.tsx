import Link from "next/link";

// The frame around every page: a dark header with the name, and a quiet footer.

export function SiteHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header className="bg-ink text-cream">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3.5">
        <Link href="/" className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex h-10 w-10 items-center justify-center rounded-full bg-cream text-xl shadow-inner"
          >
            🛺
          </span>
          <span>
            <span className="block whitespace-nowrap font-display text-xl leading-none tracking-tight sm:text-2xl">
              Dhaka Tesla Pool
            </span>
            <span className="mt-1 hidden text-xs text-stone-400 sm:block">
              Share a seat. Split the fare.
            </span>
          </span>
        </Link>
        {right}
      </div>
      <div className="h-0.5 bg-gradient-to-r from-transparent via-gold/70 to-transparent" />
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-stone-300/70">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-5 py-6 text-xs text-stone-500 sm:flex-row sm:items-center sm:justify-between">
        <p>
          <span className="font-display text-sm text-ink">
            Dhaka Tesla Pool
          </span>
          {" · "}Pooled Tesla rides on fixed routes across Dhaka
        </p>
        <p>Cash fares · 3 seats a car · © {new Date().getFullYear()}</p>
      </div>
    </footer>
  );
}
