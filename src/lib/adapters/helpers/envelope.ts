// src/lib/adapters/helpers/envelope.ts
//
// Functions: envelopeError

/**
 * The failure a tracker signalled inside an HTTP 200 body, or null when the
 * body reports success.
 *
 * fetchRaw needs this. adapterFetch throws on a non-2xx, so the only failure
 * that reaches fetchRaw intact is one the tracker wrapped in a successful
 * response, and the debug view marks a call healthy purely on `error` being
 * null (DebugResponseDialog.tsx). An unchecked error body therefore renders a
 * rejected key as a green call, which is the opposite of what the Raw tab is
 * opened to find out.
 *
 * Two envelope shapes are in use across the adapters and neither is worth its
 * own helper:
 *   Gazelle and GGn   { status: "success" | ..., error?: string }
 *   Hawke             { success: boolean, message?: string }
 * A tracker whose failure is a missing field rather than an envelope flag
 * (MAM) is not covered here and checks for itself.
 */
export function envelopeError(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null
  const body = data as Record<string, unknown>

  if (typeof body.status === "string" && body.status !== "success") {
    const reason = typeof body.error === "string" ? body.error.trim() : ""
    return reason || `Tracker returned status: ${body.status}`
  }

  if (typeof body.success === "boolean" && !body.success) {
    const reason = typeof body.message === "string" ? body.message.trim() : ""
    return reason || "Tracker reported a failure with no message"
  }

  return null
}
