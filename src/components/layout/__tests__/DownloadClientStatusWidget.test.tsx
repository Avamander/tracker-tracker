// src/components/layout/__tests__/DownloadClientStatusWidget.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DownloadClientStatusWidget } from "@/components/layout/DownloadClientStatusWidget"

const fetchMock = vi.fn()

function client(publicUrl: string | null) {
  return {
    id: 1,
    name: "qBittorrent",
    enabled: true,
    lastError: null,
    errorSince: null,
    lastPolledAt: null,
    publicUrl,
  }
}

function renderWith(publicUrl: string | null) {
  fetchMock.mockImplementation(async (url: string) =>
    Response.json(url === "/api/clients" ? [client(publicUrl)] : [])
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <DownloadClientStatusWidget />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  // MarqueeText builds a ResizeObserver, which jsdom lacks.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("DownloadClientStatusWidget", () => {
  it("links to the client's web UI at its public URL", async () => {
    renderWith("https://qbt.example.com")

    const link = await screen.findByRole("link", { name: "Open qBittorrent" })
    expect(link).toHaveAttribute("href", "https://qbt.example.com")
    expect(link).toHaveAttribute("target", "_blank")
  })

  it("shows no link without a public URL", async () => {
    renderWith(null)

    await screen.findByText("qBittorrent")
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })
})
