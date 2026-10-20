// src/lib/tracker-platforms/__tests__/c411.test.ts

import { beforeEach, describe, expect, it, vi } from "vitest"
import { C411Adapter } from "../adapters/c411"

const BASE = "https://c411.example"
const PATH = "/api/user/profile"
const TOKEN = "test-api-key"

const PROFILE = {
  id: 1234,
  username: "someone",
  avatarUrl: "/avatars/1234.webp",
  memberSince: "2025-01-02T03:04:05.000Z",
  class: {
    slug: "team_mainstream",
    effectiveSlug: "team_resident_mainstream",
    progress: { questsCompleted: 10, questsTotal: 40, grade: { tier: "argent", level: 2 } },
  },
  zen: { balance: 500, totalEarned: 900, totalSpent: 400 },
  transfer: {
    uploaded: { actual: 1_900_000_000, credit: 100_000_000, total: 2_000_000_000 },
    downloaded: { actual: 1_100_000_000, credit: 100_000_000, total: 1_000_000_000 },
  },
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe("C411Adapter", () => {
  it("reads the profile with the API key as a bearer token", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValueOnce(json(PROFILE))

    const stats = await new C411Adapter().fetchStats(BASE, ` ${TOKEN} `, PATH)

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE}${PATH}`)
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(stats).toMatchObject({
      username: "someone",
      group: "Argent II",
      uploadedBytes: 2_000_000_000n,
      downloadedBytes: 1_000_000_000n,
      ratio: 2,
      seedbonus: 500,
      remoteUserId: 1234,
      joinedDate: "2025-01-02T03:04:05.000Z",
      avatarUrl: `${BASE}/avatars/1234.webp`,
    })
  })

  it("names every grade the way the site does", async () => {
    const grades = [
      [{ tier: "bronze", level: 1 }, "Bronze I"],
      [{ tier: "bronze", level: 4 }, "Bronze IV"],
      [{ tier: "or", level: 3 }, "Or III"],
      [{ tier: "or", level: 4 }, "Or 411"],
    ] as const
    const fetchMock = vi.spyOn(global, "fetch")
    for (const [grade] of grades) {
      fetchMock.mockResolvedValueOnce(
        json({ ...PROFILE, class: { ...PROFILE.class, progress: { grade } } })
      )
    }

    const adapter = new C411Adapter()
    for (const [, name] of grades) {
      expect((await adapter.fetchStats(BASE, TOKEN, PATH)).group).toBe(name)
    }
  })

  it("falls back to the class name when there is no grade", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      json({ ...PROFILE, class: { slug: "team_mainstream", progress: { grade: { tier: "?" } } } })
    )

    expect((await new C411Adapter().fetchStats(BASE, TOKEN, PATH)).group).toBe("Team Mainstream")
  })

  it("shows an unknown class as sent, and no class rather than an empty one", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(json({ ...PROFILE, class: { slug: "new_class" } }))
      .mockResolvedValueOnce(json({ ...PROFILE, class: { effectiveSlug: "team_g4_niche" } }))
      .mockResolvedValueOnce(json({ ...PROFILE, class: null }))

    const adapter = new C411Adapter()
    expect((await adapter.fetchStats(BASE, TOKEN, PATH)).group).toBe("new_class")
    expect((await adapter.fetchStats(BASE, TOKEN, PATH)).group).toBe("team_g4_niche")
    expect((await adapter.fetchStats(BASE, TOKEN, PATH)).group).toBeNull()
  })

  it("fails rather than reporting zero when a transfer total is missing", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      json({ ...PROFILE, transfer: { uploaded: PROFILE.transfer.uploaded } })
    )

    await expect(new C411Adapter().fetchStats(BASE, TOKEN, PATH)).rejects.toThrow(
      /missing downloaded total/
    )
  })

  it("reports a rejected key as an API error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      json({ statusCode: 401, message: "Site is currently restricted." }, 401)
    )

    await expect(new C411Adapter().fetchStats(BASE, TOKEN, PATH)).rejects.toThrow(
      /^Tracker API error: 401 .*: Site is currently restricted\.$/
    )
  })

  it("returns the profile for the debug view", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(json(PROFILE))

    const calls = await new C411Adapter().fetchRaw(BASE, TOKEN, PATH)

    expect(calls).toEqual([{ label: "Profile", endpoint: PATH, data: PROFILE, error: null }])
  })

  it("flags a profile fetchStats would reject in the debug view", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(json({ ...PROFILE, transfer: null }))

    const calls = await new C411Adapter().fetchRaw(BASE, TOKEN, PATH)

    expect(calls[0]?.error).toMatch(/missing uploaded total/)
  })

  it("reports the error instead of throwing when the request fails", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("network down"))

    const calls = await new C411Adapter().fetchRaw(BASE, TOKEN, PATH)

    expect(calls[0]?.data).toBeNull()
    expect(calls[0]?.error).toBeTruthy()
  })
})
