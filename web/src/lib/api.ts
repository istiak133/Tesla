// All calls go to this app's own /api/... paths. next.config.ts forwards them to the NestJS API,
// so the session cookie stays first-party and no CORS setup is needed.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      headers:
        options.body === undefined
          ? undefined
          : { "Content-Type": "application/json" },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    // The request never got an answer. Browsers word this differently ("Failed to fetch",
    // "Load failed"), so say it plainly.
    throw new ApiError(
      0,
      "NETWORK",
      "No connection. Check your internet and try again.",
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      data?.code ?? null,
      errorMessage(response.status, data),
    );
  }
  return data as T;
}

/** What to tell the user for a failed call. */
function errorMessage(
  status: number,
  data: { message?: unknown } | null,
): string {
  if (status === 429) {
    // The rate limiter's own text is "ThrottlerException: Too Many Requests".
    return "Too many attempts. Wait a minute and try again.";
  }
  // The API sends { code, message } for business errors and { message } for validation errors.
  if (Array.isArray(data?.message)) {
    return data.message.map(String).map(sentenceCase).join(". ");
  }
  if (typeof data?.message === "string") {
    return data.message;
  }
  if (status === 502 || status === 503 || status === 504) {
    // No JSON body: the proxy answered, not the API (it is restarting or waking up).
    return "The server is starting up. Try again in a moment.";
  }
  return "Something went wrong";
}

// Validation messages start with the field name in lower case ("password must be…").
function sentenceCase(message: string): string {
  return message.charAt(0).toUpperCase() + message.slice(1);
}
