// src/components/dashboard/InboxNewsCard.test.tsx

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { InboxNewsCard } from "@/components/dashboard/InboxNewsCard"
import type { InboxTracker, TrackerSummary } from "@/types/api"

function inbox(overrides: Partial<InboxTracker>): InboxTracker {
  return {
    trackerId: 1,
    name: "Tracker",
    color: "#00d4ff",
    baseUrl: "https://t.example",
    hideUnreadBadges: false,
    unreadMessages: 0,
    unreadStaffMessages: 0,
    unreadNotifications: null,
    newNews: 0,
    checkedAt: null,
    links: null,
    messages: [],
    news: [],
    ...overrides,
  }
}

const tracker = { inbox: { newNews: 0 } } as unknown as TrackerSummary

function renderCard(trackers: InboxTracker[]) {
  vi.spyOn(global, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ trackers }), { headers: { "content-type": "application/json" } })
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <InboxNewsCard trackers={[tracker]} expanded onToggleExpanded={() => {}} />
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("InboxNewsCard", () => {
  it("lists trackers with unread items, staff first, and skips empty ones", async () => {
    renderCard([
      inbox({ trackerId: 1, name: "Quiet" }),
      inbox({ trackerId: 2, name: "Chatty", unreadMessages: 3 }),
      inbox({ trackerId: 3, name: "Staff", unreadStaffMessages: 1 }),
    ])

    const names = (await screen.findAllByRole("link", { name: /Chatty|Staff/ })).map(
      (a) => a.textContent
    )
    expect(names).toEqual(["Staff", "Chatty"])
    expect(screen.queryByText("Quiet")).not.toBeInTheDocument()
  })

  it("still lists trackers that hide their unread badges", async () => {
    renderCard([inbox({ name: "Hidden", hideUnreadBadges: true, unreadMessages: 2 })])

    expect(await screen.findByText("Hidden")).toBeInTheDocument()
  })
})
