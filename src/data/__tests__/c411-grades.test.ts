// src/data/__tests__/c411-grades.test.ts
import { describe, expect, it } from "vitest"
import { c411ClassLevel } from "@/data/c411-grades"
import { c411 } from "@/data/trackers/c411"
import { findClassIndex } from "@/lib/rank-ladder"

describe("C411 grades", () => {
  it("lists the three tiers as the ladder", () => {
    expect(c411.userClasses.map((c) => c.name)).toEqual(["Bronze", "Silver", "Gold"])
  })

  it.each([
    ["Bronze I", "Bronze", 1, 0.25],
    ["Bronze IV", "Bronze", 4, 1],
    ["Silver III", "Silver", 7, 0.75],
    ["Gold I", "Gold", 9, 0.25],
    ["Gold 411", "Gold", 12, 1],
  ])("reads %s as %s, grade %i, %f of the tier", (name, rank, level, fraction) => {
    expect(c411ClassLevel(name)).toEqual({ rank, level, fraction })
  })

  // The adapter passes an unknown tier or step through as sent.
  it.each(["Gold IV", "Platinum I", "Bronze", "Bronze V", "Silver 411", "Bronze I extra"])(
    "does not read %s as a grade",
    (name) => {
      expect(c411ClassLevel(name)).toBeNull()
    }
  )

  it("places every grade the adapter names on its tier", () => {
    const grades = ["I", "II", "III", "IV"]
    for (const [tier, steps] of [
      ["Bronze", grades],
      ["Silver", grades],
      ["Gold", ["I", "II", "III", "411"]],
    ] as const) {
      for (const step of steps) {
        const index = findClassIndex(c411.userClasses, `${tier} ${step}`, c411ClassLevel)
        expect(c411.userClasses[index]?.name).toBe(tier)
      }
    }
  })
})
