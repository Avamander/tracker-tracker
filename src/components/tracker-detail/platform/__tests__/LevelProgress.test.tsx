// src/components/tracker-detail/platform/__tests__/LevelProgress.test.tsx

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { LevelProgress } from "@/components/tracker-detail/platform/LevelProgress"

describe("LevelProgress", () => {
  it("shows the progress through the step and what is left to the next", () => {
    render(
      <LevelProgress
        current="Level 37"
        next="Level 38"
        into={310}
        need={549}
        unit="XP"
        accentColor="#00d4ff"
      />
    )

    expect(screen.getByText("310 / 549 XP")).toBeInTheDocument()
    expect(screen.getByText("239 XP to Level 38")).toBeInTheDocument()
  })

  it("names no next step when there is none", () => {
    render(
      <LevelProgress
        current="Silver II"
        next={null}
        into={23}
        need={40}
        unit="quests"
        accentColor="#00d4ff"
      />
    )

    expect(screen.getByText("23 / 40 quests")).toBeInTheDocument()
    expect(screen.queryByText(/ to /)).not.toBeInTheDocument()
  })
})
