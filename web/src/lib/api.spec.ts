import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";

// Every error message a screen shows comes from here.
describe("api()", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const answer = (status: number, body: unknown) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        typeof body === "string"
          ? new Response(body, { status })
          : Response.json(body, { status }),
      ),
    );

  const failure = async (call: Promise<unknown>) => {
    try {
      await call;
    } catch (error) {
      return error as ApiError;
    }
    throw new Error("expected the call to fail");
  };

  it("calls the same-origin proxy and sends JSON", async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    await api("/rides", { method: "POST", body: { seats: 1 } });
    expect(fetch).toHaveBeenCalledWith("/api/rides", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: '{"seats":1}',
    });
  });

  it("keeps the API's code and message for a business error", async () => {
    answer(409, {
      statusCode: 409,
      code: "FEE_CHANGED",
      message: "The car has just reached your stop: cancelling now costs Tk 20",
    });
    const error = await failure(api("/rides/x/cancel", { method: "POST" }));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "FEE_CHANGED" });
    expect(error.message).toBe(
      "The car has just reached your stop: cancelling now costs Tk 20",
    );
  });

  it("joins validation messages into sentences", async () => {
    answer(400, {
      message: ["email must be an email", "password is too short"],
    });
    const error = await failure(api("/auth/login", { method: "POST" }));
    expect(error.message).toBe("Email must be an email. Password is too short");
  });

  it("says plainly when there is no connection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const error = await failure(api("/rides/current"));
    expect(error).toMatchObject({ status: 0, code: "NETWORK" });
    expect(error.message).toBe(
      "No connection. Check your internet and try again.",
    );
  });

  it("turns the rate limiter's 429 into words a person understands", async () => {
    answer(429, {
      statusCode: 429,
      message: "ThrottlerException: Too Many Requests",
    });
    const error = await failure(api("/auth/login", { method: "POST" }));
    expect(error.message).toBe(
      "Too many attempts. Wait a minute and try again.",
    );
  });

  it("explains a proxy error page while the API restarts", async () => {
    answer(502, "<html>Bad gateway</html>");
    const error = await failure(api("/auth/me"));
    expect(error.message).toBe(
      "The server is starting up. Try again in a moment.",
    );
  });

  it("keeps the API's own message on a 503 that has one (the car is busy)", async () => {
    answer(503, {
      code: "BUSY",
      message: "The vehicle is busy, please try again",
    });
    const error = await failure(api("/driver/pool/arrive", { method: "POST" }));
    expect(error.message).toBe("The vehicle is busy, please try again");
  });
});
