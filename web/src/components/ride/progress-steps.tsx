import type { RideStatus } from "@/lib/types";

const STEPS: { status: RideStatus; label: string }[] = [
  { status: "REQUESTED", label: "Requested" },
  { status: "MATCHED", label: "Matched" },
  { status: "DRIVER_ARRIVED", label: "Driver arrived" },
  { status: "STARTED", label: "On the way" },
  { status: "COMPLETED", label: "Completed" },
];

/** A simple horizontal progress line for the ride lifecycle. */
export function ProgressSteps({ status }: { status: RideStatus }) {
  const currentIndex = STEPS.findIndex((step) => step.status === status);

  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((step, index) => {
        const done = currentIndex >= 0 && index <= currentIndex;
        return (
          <li key={step.status} className="flex flex-1 flex-col gap-1.5">
            <span
              className={`h-1.5 rounded-full ${done ? "bg-zinc-900" : "bg-zinc-200"}`}
            />
            <span
              className={`text-xs ${done ? "font-medium text-zinc-900" : "text-zinc-400"}`}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
