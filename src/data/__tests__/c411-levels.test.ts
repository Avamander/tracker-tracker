// src/data/__tests__/c411-levels.test.ts
import { describe, expect, it } from "vitest"
import { c411LevelName, c411LevelStep } from "@/data/c411-levels"
import { c411 } from "@/data/trackers/c411"
import { findClassIndex } from "@/lib/rank-ladder"

const LEVELS = c411.secondaryLadder?.userClasses ?? []

describe("C411 levels", () => {
  it("lists the levels that unlock something as the second ladder", () => {
    expect(LEVELS.map((c) => c.name)).toEqual([
      "Level 1–3",
      "Level 4–6",
      "Level 7–9",
      "Level 10–14",
      "Level 15–24",
      "Level 25+",
    ])
    expect(LEVELS[1].perks?.map((p) => p.label)).toContain("Comment on torrents")
    expect(LEVELS[5].perks?.map((p) => p.label)).toContain("Apply to the Team Pending")
  })

  it.each([
    ["Level 1", "Level 1–3", 0],
    ["Level 3", "Level 1–3", 2 / 3],
    ["Level 12", "Level 10–14", 2 / 5],
    ["Level 25", "Level 25+", 1],
    ["Level 37", "Level 25+", 1],
  ])("reads %s as part of %s, %f of the way to the next", (name, rank, fraction) => {
    expect(c411LevelStep(name)).toEqual({ rank, level: Number(name.slice(6)), fraction })
  })

  it.each(["Level 0", "Silver II", "Level", "Level 2.5"])("does not read %s as a level", (name) => {
    expect(c411LevelStep(name)).toBeNull()
  })

  it("places every level the adapter names on a rung", () => {
    for (let level = 1; level <= 60; level++) {
      expect(findClassIndex(LEVELS, c411LevelName(level), c411LevelStep)).not.toBe(-1)
    }
  })
})
