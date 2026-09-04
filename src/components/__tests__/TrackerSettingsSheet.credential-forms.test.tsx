// src/components/__tests__/TrackerSettingsSheet.credential-forms.test.tsx
//
// The sheet validates cookies through the same table as the dialog; pins the
// message for a bare cookie name pasted on its own.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { trackerQueryOptions } from "@/lib/query-options"
import type { TrackerSummary } from "@/types/api"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

import { TrackerSettingsSheet } from "@/components/TrackerSettingsSheet"

const RETROTOON: TrackerSummary = {
  id: 42,
  name: "RetroToon World",
  baseUrl: "https://retrotoon.world",
  platformType: "retrotoon",
  isActive: true,
  lastPolledAt: null,
  lastError: null,
  lastErrorAt: null,
  consecutiveFailures: 0,
  pausedAt: null,
  userPausedAt: null,
  color: "#01d4ff",
  qbtTag: "retrotoon",
  mouseholeUrl: null,
  useProxy: false,
  countCrossSeedUnsatisfied: false,
  hideUnreadBadges: false,
  isFavorite: false,
  sortOrder: null,
  joinedAt: null,
  lastAccessAt: null,
  remoteUserId: null,
  platformMeta: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  latestStats: null,
}

const fetchMock = vi.fn()

function jsonResponse(body: unknown, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body }
}

/** Every call that would have written or verified the credential. */
function credentialRequests() {
  return fetchMock.mock.calls.filter(([url]) => String(url) !== "/api/settings")
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: unknown) => {
    const target = String(url)
    if (target === "/api/settings") return jsonResponse({ proxyEnabled: false })
    if (target === "/api/trackers/test-connection") return jsonResponse({ username: "someone" })
    return jsonResponse(RETROTOON)
  })
  vi.stubGlobal("fetch", fetchMock)
})

function renderSheet() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(trackerQueryOptions.queryKey, [RETROTOON])
  render(
    <QueryClientProvider client={queryClient}>
      <TrackerSettingsSheet
        open
        tracker={RETROTOON}
        onClose={vi.fn()}
        onUpdated={vi.fn()}
      />
    </QueryClientProvider>
  )
}

describe("TrackerSettingsSheet cookie credentials", () => {
  it("says a bare cookie name is a name, not a malformed cookie string", async () => {
    const user = userEvent.setup()
    renderSheet()

    await user.click(screen.getByRole("button", { name: "Change" }))
    await user.type(screen.getByLabelText("Browser Cookies"), "PHPSESSID")
    await user.click(screen.getByRole("button", { name: "Save Changes" }))

    expect(await screen.findByText(/you pasted a cookie name \("PHPSESSID"\)/)).toBeInTheDocument()
    expect(credentialRequests()).toEqual([])
  })

  it("stores the cookies with this browser's user agent", async () => {
    const user = userEvent.setup()
    renderSheet()

    await user.click(screen.getByRole("button", { name: "Change" }))
    await user.type(screen.getByLabelText("Browser Cookies"), "Cookie: PHPSESSID=abc123")
    await user.click(screen.getByRole("button", { name: "Save Changes" }))

    await waitFor(() => expect(credentialRequests().length).toBeGreaterThan(0))
    const patch = credentialRequests().find(([, init]) => init?.method === "PATCH")
    const blob = JSON.parse(JSON.parse(String(patch?.[1]?.body)).apiToken)
    expect(blob).toEqual({ cookies: "PHPSESSID=abc123", userAgent: navigator.userAgent })
  })
})
