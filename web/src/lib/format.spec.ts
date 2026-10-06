import { describe, expect, it } from "vitest";
import { dhakaTime, taka } from "./format";

describe("taka", () => {
  it("shows paisa as whole taka", () => {
    expect(taka(7500)).toBe("৳75");
    expect(taka(0)).toBe("৳0");
  });
});

describe("dhakaTime", () => {
  it("is Dhaka time whatever the machine's time zone", () => {
    // 02:30 UTC is 08:30 in Dhaka (UTC+6).
    expect(dhakaTime("2026-10-06T02:30:00Z")).toBe("6 Oct, 08:30");
  });
});
