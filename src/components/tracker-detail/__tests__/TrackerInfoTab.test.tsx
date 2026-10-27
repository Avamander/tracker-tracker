// src/components/tracker-detail/__tests__/TrackerInfoTab.test.tsx
//
// Key Rules print the registry's numbers with their units, and a rule of one
// reads in the singular. BroadcasTheNet's 24-hour seed time read "1 days".

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { TrackerInfoTab } from "@/components/tracker-detail/TrackerInfoTab"
import { getTrackerBySlug, type TrackerRegistryEntry } from "@/data/tracker-registry"
import { c411 } from "@/data/trackers/c411"
import type { PlatformMeta, TrackerLatestStats } from "@/types/api"

const stats = { group: "Bronze II" } as TrackerLatestStats

function rowOf(name: string): HTMLElement | null {
  return screen.getByText(name).closest("div.flex.items-center.justify-between")
}

function renderRules(entry: TrackerRegistryEntry | undefined) {
  render(<TrackerInfoTab registryEntry={entry} stats={null} accentColor="#00d4ff" />)
}

describe("TrackerInfoTab Key Rules", () => {
  it("reads BroadcasTheNet's 24-hour seed time as one day", () => {
    renderRules(getTrackerBySlug("broadcasthenet"))

    expect(screen.getByText("1 day")).toBeInTheDocument()
    expect(screen.getByText("60 days")).toBeInTheDocument()
  })

  it("writes a rule of one in the singular and the rest in the plural", () => {
    const btn = getTrackerBySlug("broadcasthenet")
    if (!btn?.rules) throw new Error("registry entry missing")
    renderRules({
      ...btn,
      rules: {
        ...btn.rules,
        seedTimeHours: 1,
        fulfillmentPeriodHours: 30,
        loginIntervalDays: 1,
        hnrBanLimit: 1,
      },
    })

    expect(screen.getByText("1 hour")).toBeInTheDocument()
    expect(screen.getByText("30 hours")).toBeInTheDocument()
    expect(screen.getByText("1 day")).toBeInTheDocument()
    expect(screen.getByText("1 warning")).toBeInTheDocument()
  })
})

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
    expect(rowOf("Level 10–14")).toHaveTextContent("← you")
    expect(rowOf("Level 15–24")).not.toHaveTextContent("← you")
  })

  it("lists the levels without marking one before a poll reports the level", () => {
    render(<TrackerInfoTab registryEntry={c411} stats={stats} accentColor="#00d4ff" />)

    expect(screen.getByText("User Levels")).toBeInTheDocument()
    expect(screen.getAllByText("← you")).toHaveLength(1)
  })
})
