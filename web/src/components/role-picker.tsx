import type { Role } from "@/lib/types";

const CHOICES: { role: Role; icon: string; title: string; hint: string }[] = [
  {
    role: "PASSENGER",
    icon: "🧑",
    title: "Passenger",
    hint: "Book a seat in a Tesla going your way",
  },
  {
    role: "DRIVER",
    icon: "🚘",
    title: "Driver",
    hint: "Drive a fixed route and fill your seats",
  },
];

export const ROLE_NAME: Record<Role, string> = {
  PASSENGER: "Passenger",
  DRIVER: "Driver",
};

/** Step one of login and sign-up: which kind of account (D-015). */
export function RolePicker({ onPick }: { onPick: (role: Role) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {CHOICES.map((choice) => (
        <button
          key={choice.role}
          type="button"
          onClick={() => onPick(choice.role)}
          className="group rounded-xl border border-stone-200 bg-cream/40 p-4 text-left transition hover:-translate-y-0.5 hover:border-ink hover:bg-paper hover:shadow-md"
        >
          <span className="text-2xl" aria-hidden>
            {choice.icon}
          </span>
          <span className="mt-2 block font-medium">
            I’m a {choice.title.toLowerCase()}
          </span>
          <span className="mt-0.5 block text-xs text-stone-500">
            {choice.hint}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Shown above the form once a type is chosen, with a way back. */
export function ChosenRole({
  role,
  onChange,
}: {
  role: Role;
  onChange: () => void;
}) {
  return (
    <div className="mb-5 flex items-center justify-between rounded-lg bg-ink px-3 py-2 text-sm text-cream">
      <span>
        {role === "DRIVER" ? "🚘" : "🧑"} {ROLE_NAME[role]} account
      </span>
      <button
        type="button"
        onClick={onChange}
        className="text-xs text-stone-300 underline-offset-2 hover:text-cream hover:underline"
      >
        Change
      </button>
    </div>
  );
}
