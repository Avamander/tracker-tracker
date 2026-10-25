// src/components/tracker-detail/__tests__/ProwlarrIndexerCard.test.tsx

import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ProwlarrIndexerCard } from "@/components/tracker-detail/ProwlarrIndexerCard"
import type { TrackerProwlarrIndexer } from "@/types/api"

function indexer(overrides: Partial<TrackerProwlarrIndexer> = {}): TrackerProwlarrIndexer {
  return {
    instanceId: 3,
    instanceName: "Home",
    instanceUrl: "http://prowlarr.test:9696",
    instanceError: null,
    stale: false,
    indexerId: 12,
    name: "Example Indexer",
    enabled: true,
    disabledTill: null,
    mostRecentFailure: null,
    initialFailure: null,
    checkedAt: "2026-08-14T12:00:00.000Z",
    ...overrides,
  }
}

describe("ProwlarrIndexerCard", () => {
  it("names the indexer and links its instance to Prowlarr's Indexers page", () => {
    render(<ProwlarrIndexerCard indexers={[indexer()]} />)

    expect(screen.getByText("OK")).toBeInTheDocument()
    expect(screen.getByText(/Example Indexer/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Home →" })).toHaveAttribute(
      "href",
      "http://prowlarr.test:9696/indexers"
    )
  })

  it("collapses its details from the header", () => {
    localStorage.clear()
    render(
      <ProwlarrIndexerCard indexers={[indexer({ disabledTill: "2026-08-14T13:00:00.000Z" })]} />
    )
    const details = screen.getByText(/^Failing in Prowlarr/).closest(".overflow-hidden")
    expect(details).toHaveClass("max-h-125")

    fireEvent.click(screen.getByRole("button", { name: /Failing/ }))

    expect(details).toHaveClass("max-h-0")
  })

  it("shows a failing indexer with since when", () => {
    render(
      <ProwlarrIndexerCard
        indexers={[
          indexer({
            disabledTill: "2026-08-14T13:00:00.000Z",
            initialFailure: "2026-08-14T10:00:00.000Z",
          }),
        ]}
      />
    )

    expect(screen.getByText("Failing")).toBeInTheDocument()
    expect(screen.getByText(/^Failing in Prowlarr since/)).toBeInTheDocument()
  })

  it("shows how far away a date is when it is hovered", () => {
    vi.useFakeTimers({ now: new Date("2026-08-14T12:00:00.000Z"), toFake: ["Date"] })
    try {
      render(
        <ProwlarrIndexerCard
          indexers={[
            indexer({
              disabledTill: "2026-08-14T15:30:00.000Z",
              initialFailure: "2026-08-12T07:00:00.000Z",
            }),
          ]}
        />
      )
      const dates = screen.getByText(/^Failing in Prowlarr/).querySelectorAll("span")

      fireEvent.mouseEnter(dates[0] as HTMLElement)
      expect(screen.getByRole("tooltip")).toHaveTextContent("2 days, 5 hours")
      fireEvent.mouseEnter(dates[1] as HTMLElement)
      expect(screen.getAllByRole("tooltip").at(-1)).toHaveTextContent("3 hours")
    } finally {
      vi.useRealTimers()
    }
  })

  it("shows Prowlarr's own error in its own words", () => {
    render(
      <ProwlarrIndexerCard
        indexers={[indexer({ instanceError: "API key rejected by Prowlarr" })]}
      />
    )

    expect(screen.getByText("Prowlarr error")).toBeInTheDocument()
    expect(screen.getByText("API key rejected by Prowlarr")).toBeInTheDocument()
  })

  it("renders nothing without indexers", () => {
    const { container } = render(<ProwlarrIndexerCard indexers={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
