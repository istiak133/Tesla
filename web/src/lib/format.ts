import type { RideStatus } from "./types";

/** 7500 paisa → "৳75". Every fare is a whole number of taka. */
export function taka(paisa: number): string {
  return `৳${Math.round(paisa / 100)}`;
}

export const STATUS_LABEL: Record<RideStatus, string> = {
  REQUESTED: "Waiting for a driver",
  MATCHED: "Matched",
  DRIVER_ARRIVED: "Car at the stop",
  STARTED: "On board",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** Shown in Dhaka time, whatever the browser's time zone. */
export function dhakaTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}
