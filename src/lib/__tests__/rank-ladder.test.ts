// src/lib/__tests__/rank-ladder.test.ts

import { describe, expect, it } from "vitest"
import type { TrackerUserClass } from "@/data/tracker-registry"
import { REDACTED_PREFIX } from "@/lib/privacy"
import { buildRankLadder, findClassIndex } from "@/lib/rank-ladder"

const classes: TrackerUserClass[] = [
  { name: "Banned", requirements: "Broke the rules", outsideLadder: "below" },
  { name: "Leech", requirements: "Ratio below 0.4", outsideLadder: "below" },
  { name: "User", requirements: "Ratio at or above 0.4" },
  { name: "Power User", requirements: "1 TiB up" },
  { name: "VIP", requirements: "Donation", outsideLadder: "above" },
  { name: "Uploader", requirements: "Staff", outsideLadder: "above" },
]

describe("findClassIndex", () => {
  it("matches class names case-insensitively", () => {
    expect(findClassIndex(classes, "power user")).toBe(3)
    expect(findClassIndex(classes, "POWER USER")).toBe(3)
  })

  it("returns -1 for null, unknown, or redacted names", () => {
    expect(findClassIndex(classes, null)).toBe(-1)
    expect(findClassIndex(classes, undefined)).toBe(-1)
    expect(findClassIndex(classes, "Elite")).toBe(-1)
    expect(findClassIndex(classes, `${REDACTED_PREFIX}abc`)).toBe(-1)
  })
})

describe("buildRankLadder", () => {
  it("keeps only earned classes, in order, and points at the current one", () => {
    const ladder = buildRankLadder(classes, "User")
    expect(ladder).not.toBeNull()
    expect(ladder?.rungs.map((r) => r.name)).toEqual(["User", "Power User"])
    expect(ladder?.currentIndex).toBe(0)
    expect(ladder?.appointedClass).toBeNull()
  })

  it("carries the requirements text onto each rung", () => {
    const ladder = buildRankLadder(classes, "User")
    expect(ladder?.rungs[1]).toEqual({ name: "Power User", requirements: "1 TiB up" })
  })

  it("renders a class above the ladder as a full stack under its own name", () => {
    const ladder = buildRankLadder(classes, "vip")
    expect(ladder?.currentIndex).toBe(1)
    expect(ladder?.appointedClass).toBe("VIP")
  })

  it("renders a class below the ladder as an empty stack", () => {
    const ladder = buildRankLadder(classes, "Leech")
    expect(ladder?.currentIndex).toBe(-1)
    expect(ladder?.appointedClass).toBeNull()
  })

  it("leaves the index at -1 when the current class is unknown or redacted", () => {
    expect(buildRankLadder(classes, null)?.currentIndex).toBe(-1)
    expect(buildRankLadder(classes, "Elite")?.currentIndex).toBe(-1)
    expect(buildRankLadder(classes, `${REDACTED_PREFIX}abc`)?.currentIndex).toBe(-1)
    expect(buildRankLadder(classes, `${REDACTED_PREFIX}abc`)?.appointedClass).toBeNull()
  })

  it("returns null when the tracker has no earned classes at all", () => {
    expect(buildRankLadder([], "User")).toBeNull()
    expect(buildRankLadder([{ name: "Staff", outsideLadder: "above" }], "Staff")).toBeNull()
  })
})
