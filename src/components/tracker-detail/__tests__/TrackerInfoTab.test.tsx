// src/components/tracker-detail/__tests__/TrackerInfoTab.test.tsx

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { TrackerInfoTab } from "@/components/tracker-detail/TrackerInfoTab"
import { c411 } from "@/data/trackers/c411"
import type { PlatformMeta, TrackerLatestStats } from "@/types/api"

const stats = { group: "Bronze II" } as TrackerLatestStats

function rowOf(name: string): HTMLElement | null {
  return screen.getByText(name).closest("div.flex.items-center.justify-between")
}

describe("TrackerInfoTab ranks", () => {
  it("marks the rank a grade sits in", () => {
    render(<TrackerInfoTab registryEntry={c411} stats={stats} accentColor="#00d4ff" />)

    expect(rowOf("Bronze")).toHaveTextContent("← you")
    expect(rowOf("Silver")).not.toHaveTextContent("← you")
  })

  // C411's levels are what unlock its features, so they are listed beside the grades.
  it("lists the second ladder with its unlocks, marking the member's rung", () => {
    render(
      <TrackerInfoTab
        registryEntry={c411}
        stats={stats}
        platformMeta={{ level: 12 } as PlatformMeta}
        accentColor="#00d4ff"
      />
    )

    expect(screen.getByText("User Levels")).toBeInTheDocument()
    expect(screen.getByText("Comment on torrents")).toBeInTheDocument()
    expect(rowOf("Level 10")).toHaveTextContent("← you")
    expect(rowOf("Level 15")).not.toHaveTextContent("← you")
  })

  it("lists the levels without marking one before a poll reports the level", () => {
    render(<TrackerInfoTab registryEntry={c411} stats={stats} accentColor="#00d4ff" />)

    expect(screen.getByText("User Levels")).toBeInTheDocument()
    expect(screen.getAllByText("← you")).toHaveLength(1)
  })
})
