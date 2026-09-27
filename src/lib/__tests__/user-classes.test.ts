// src/lib/__tests__/user-classes.test.ts

import { describe, expect, it } from "vitest"
import type { TrackerUserClass } from "@/data/tracker-registry"
import { ladderClasses } from "@/lib/user-classes"

describe("ladderClasses", () => {
  const classes: TrackerUserClass[] = [
    { name: "User" },
    { name: "Power User" },
    { name: "VIP", offLadder: true },
    { name: "Elite" },
    { name: "Staff", offLadder: true },
  ]

  it("keeps the promotion ladder in order and drops off-ladder classes", () => {
    expect(ladderClasses(classes).map((uc) => uc.name)).toEqual(["User", "Power User", "Elite"])
  })

  it("returns every class when none is off-ladder", () => {
    expect(ladderClasses([{ name: "A" }, { name: "B" }])).toHaveLength(2)
  })
})
