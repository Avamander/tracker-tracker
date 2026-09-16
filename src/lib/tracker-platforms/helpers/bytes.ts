// src/lib/tracker-platforms/helpers/bytes.ts
//
// Functions: requireBytes

import { floatBytesToBigInt } from "@/lib/data-transforms"

/**
 * A byte total the API is contracted to send, as a bigint, or an error naming
 * the field.
 *
 * `uploadedBytes` and `downloadedBytes` are non-nullable `bigint` on
 * `TrackerStats`, so an absent total cannot be reported as unknown and has to
 * fail the poll instead. Reading it as 0 is the shape section 2.1 forbids: the
 * account looks like it stopped seeding, `computeRatio` returns 0, which is the
 * worst value the app can hold, the ratio-danger alert and the no-seeds badge
 * both fire, and the zero is written into snapshot history where no later
 * reader can tell it from a real one.
 *
 * Takes `unknown` on purpose. Every adapter declares these fields required and
 * none of them is checked at runtime, so the declared type is a statement about
 * the tracker's documentation rather than about the bytes that arrived.
 */
export function requireBytes(value: unknown, field: string, hostname: string): bigint {
  if (value == null) {
    throw new Error(`Unexpected response from ${hostname}: missing ${field}`)
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Unexpected response from ${hostname}: non-numeric ${field}`)
  }
  return floatBytesToBigInt(value)
}
