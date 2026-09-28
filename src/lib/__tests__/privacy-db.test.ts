// src/lib/__tests__/privacy-db.test.ts

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({
  db: {
    execute: vi.fn(),
  },
}))

import { scrubSnapshotUsernames } from "../privacy-db"

const { db } = await import("@/lib/db")

// What postgres.js resolves an UPDATE with: the rows, none without RETURNING,
// and the changed-row count from the command tag as `count`.
function updateResult(count: number) {
  return Object.assign([], { command: "UPDATE", count })
}

describe("scrubSnapshotUsernames", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("scrubs snapshots and message senders in one batch UPDATE each", async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce(updateResult(5) as never)
      .mockResolvedValueOnce(updateResult(2) as never)

    const count = await scrubSnapshotUsernames()

    expect(db.execute).toHaveBeenCalledTimes(2)
    expect(count).toBe(7)
  })

  it("returns 0 when no rows match", async () => {
    vi.mocked(db.execute).mockResolvedValue(updateResult(0) as never)

    const count = await scrubSnapshotUsernames()

    expect(count).toBe(0)
  })
})
