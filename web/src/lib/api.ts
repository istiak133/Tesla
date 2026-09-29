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
  const response = await fetch(`/api${path}`, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    headers:
      options.body === undefined
        ? undefined
        : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    // The API sends { code, message } for business errors and { message } for validation errors.
    const message = Array.isArray(data?.message)
      ? data.message.join(", ")
      : (data?.message ?? "Something went wrong");
    throw new ApiError(response.status, data?.code ?? null, message);
  }
  return data as T;
}
