// src/lib/tracker-platforms/__tests__/v3x.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest"
import { parseV3xMe, parseV3xProfile, V3xAdapter } from "../adapters/v3x"
import { SessionExpiredError } from "../helpers/errors"

// Synthetic fixture shaped like /auth/me. No real account data.
const ME = {
  username: "testuser",
  role: "power_user",
  status: "active",
  uploaded: 186064294312,
  downloaded: 74273761201,
  downloadedReal: 73200019377,
  bonusPoints: 18591,
  seedTimeSeconds: 37339256,
  freeleechTokens: 0,
  createdAt: "2026-09-05T13:57:58.012Z",
  ratio: 2.505114744471765,
  ratioFloor: { enabled: true, floor: 0.5, warnAt: 0.7, level: "ok" },
  hnr: { enabled: true, active: 1, uploader: 0, max: 3, exempt: false },
}

const GAME = {
  xp: 28020,
  level: 14,
  prestige: 0,
  rank: { key: "second", label: "Second rôle" },
  nextRank: { label: "Tête d'affiche", atLevel: 25 },
  into: 4100,
  need: 4248,
  maxed: false,
  loginStreak: 20,
  seedStreak: 37,
  missions: [],
}

const HOST = "https://v3x.club"
const PROFILE = {
  id: 4242,
  username: "testuser",
  lastLoginAt: "2026-10-25T08:00:00.000Z",
  invitesLeft: 2,
  uploadBonusBytes: 10737418240,
}
const SEEDS_SEEDING = "/me/seeds?kind=seeding&perPage=1"
const SEEDS_LEECHING = "/me/seeds?kind=leeching&perPage=1"
// Every read after /auth/me, by path and query
const FIXTURES: Record<string, unknown> = {
  "/me/gamification": GAME,
  "/notifications/unread-count": { unread: 3 },
  "/messages/unread": { count: 2 },
  "/conversations/unread": { count: 1 },
  [SEEDS_SEEDING]: { rows: [{}], total: 120 },
  [SEEDS_LEECHING]: { rows: [], total: 0 },
  "/me/warnings": { warnings: [], threshold: 3 },
  "/users/testuser": PROFILE,
}
const CREDENTIALS = JSON.stringify({ cookies: "v3x_session=abc", userAgent: "Mozilla/5.0" })

const jsonResponse = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response

const statusResponse = (status: number, statusText: string) =>
  ({
    ok: false,
    status,
    statusText,
    headers: { get: () => null },
    body: null,
    json: async () => ({}),
    text: async () => "",
  }) as unknown as Response

describe("parseV3xMe", () => {
  it("maps the API payload into TrackerStats", () => {
    const stats = parseV3xMe(ME)

    expect(stats.username).toBe("testuser")
    expect(stats.group).toBeNull()
    expect(stats.uploadedBytes).toBe(186064294312n)
    expect(stats.downloadedBytes).toBe(74273761201n)
    expect(stats.ratio).toBeCloseTo(2.505114744471765, 10)
    expect(stats.bufferBytes).toBe(111790533111n)
    expect(stats.seedbonus).toBe(18591)
    expect(stats.hitAndRuns).toBe(1)
    expect(stats.requiredRatio).toBe(0.5)
    expect(stats.freeleechTokens).toBe(0)
    expect(stats.joinedDate).toBe("2026-09-05T13:57:58.012Z")
    expect(stats.seedingCount).toBeNull()
    expect(stats.leechingCount).toBeNull()
    expect(stats.warned).toBeNull()
    expect(stats.platformMeta).toEqual({ freeleechDownloadedBytes: 0 })
  })

  it("counts the real download above the counted one as freeleech", () => {
    const stats = parseV3xMe({ ...ME, downloaded: 1000, downloadedReal: 1500 })

    expect(stats.platformMeta).toEqual({ freeleechDownloadedBytes: 500 })
  })

  it("leaves out the freeleech figure without a real download", () => {
    expect(parseV3xMe({ ...ME, downloadedReal: undefined }).platformMeta).toBeUndefined()
  })

  it.each(["uploaded", "downloaded"])("fails when %s is missing", (field) => {
    expect(() => parseV3xMe({ ...ME, [field]: undefined })).toThrow(
      `Unexpected response from api.v3x.club: missing ${field}`
    )
  })

  it("reads a zero-download account", () => {
    const stats = parseV3xMe({ ...ME, downloaded: 0 })

    expect(stats.downloadedBytes).toBe(0n)
    expect(stats.ratio).toBe(Number.POSITIVE_INFINITY)
  })

  it("fails on a body without a user object", () => {
    expect(() => parseV3xMe(null)).toThrow(
      "Unexpected response from api.v3x.club: missing user object"
    )
  })
})

describe("V3xAdapter", () => {
  const adapter = new V3xAdapter()

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  // Answers each API path with its fixture, or the given response for that path
  const routeFetch = (overrides: Record<string, Response | Error> = {}) => {
    const inits: { url: string; init?: RequestInit }[] = []
    vi.spyOn(global, "fetch").mockImplementation((url, init) => {
      inits.push({ url: String(url), init })
      const { pathname, search } = new URL(String(url))
      const path = pathname + search
      const override = overrides[path]
      if (override instanceof Error) return Promise.reject(override)
      if (override) return Promise.resolve(override)
      return Promise.resolve(jsonResponse(path === "/auth/me" ? ME : FIXTURES[path]))
    })
    return inits
  }

  it("reads /auth/me and takes the class from the gamification rank", async () => {
    const inits = routeFetch()

    const stats = await adapter.fetchStats(HOST, CREDENTIALS, "/auth/me")
    const headers = inits[0].init?.headers as Record<string, string>

    expect(inits.map((c) => c.url)).toEqual([
      "https://api.v3x.club/auth/me",
      "https://api.v3x.club/me/gamification",
      "https://api.v3x.club/notifications/unread-count",
      "https://api.v3x.club/messages/unread",
      "https://api.v3x.club/conversations/unread",
      "https://api.v3x.club/me/seeds?kind=seeding&perPage=1",
      "https://api.v3x.club/me/seeds?kind=leeching&perPage=1",
      "https://api.v3x.club/me/warnings",
      "https://api.v3x.club/users/testuser",
    ])
    expect(stats.uploadedBytes).toBe(186064294312n)
    expect(stats.group).toBe("Second rôle")
    expect(headers.Cookie).toBe("v3x_session=abc")
    expect(headers["User-Agent"]).toBe("Mozilla/5.0")
    expect(headers.Accept).toBe("application/json")
    expect(headers["Sec-Fetch-Mode"]).toBeUndefined()
  })

  it("reads the peer counts, warnings and profile", async () => {
    routeFetch()

    const stats = await adapter.fetchStats(HOST, CREDENTIALS, "/auth/me")

    expect(stats).toMatchObject({
      seedingCount: 120,
      leechingCount: 0,
      warned: false,
      remoteUserId: 4242,
      lastAccessDate: "2026-10-25T08:00:00.000Z",
      platformMeta: { freeleechDownloadedBytes: 0, invites: 2, bonusUploadedBytes: 10737418240 },
    })
  })

  it("reads an active warning as warned", async () => {
    routeFetch({ "/me/warnings": jsonResponse({ warnings: [{ id: 1 }], threshold: 3 }) })

    const stats = await adapter.fetchStats(HOST, CREDENTIALS, "/auth/me")

    expect(stats.warned).toBe(true)
  })

  it("leaves each failed read unknown and keeps the rest", async () => {
    routeFetch({
      [SEEDS_SEEDING]: new TypeError("fetch failed"),
      [SEEDS_LEECHING]: jsonResponse({ rows: [] }),
      "/me/warnings": statusResponse(500, "Internal Server Error"),
      "/users/testuser": statusResponse(404, "Not Found"),
    })

    const stats = await adapter.fetchStats(HOST, CREDENTIALS, "/auth/me")

    expect(stats.seedingCount).toBeNull()
    expect(stats.leechingCount).toBeNull()
    expect(stats.warned).toBeNull()
    expect(stats.remoteUserId).toBeUndefined()
    expect(stats.lastAccessDate).toBeUndefined()
    expect(stats.platformMeta).toEqual({ freeleechDownloadedBytes: 0 })
    expect(stats.group).toBe("Second rôle")
    expect(stats.inbox?.unreadNotifications).toBe(3)
  })

  it("rethrows a 401 from the profile", async () => {
    routeFetch({ "/users/testuser": statusResponse(401, "Unauthorized") })

    await expect(adapter.fetchStats(HOST, CREDENTIALS, "/auth/me")).rejects.toBeInstanceOf(
      SessionExpiredError
    )
  })

  it("adds direct and group messages, and reads notifications", async () => {
    routeFetch()

    const stats = await adapter.fetchStats(HOST, CREDENTIALS, "/auth/me")

    expect(stats.inbox).toEqual({
      unreadMessages: 3,
      unreadStaffMessages: null,
      unreadNotifications: 3,
      links: { inbox: "https://v3x.club/messages" },
    })
  })

  it.each([
    ["a failed count", { "/conversations/unread": new TypeError("fetch failed") }],
    ["a malformed count", { "/notifications/unread-count": jsonResponse({ unread: "3" }) }],
  ])("leaves the inbox unset on %s and keeps the stats", async (_, overrides) => {
    routeFetch(overrides)

    const stats = await adapter.fetchStats(HOST, CREDENTIALS, "/auth/me")

    expect(stats.inbox).toBeUndefined()
    expect(stats.group).toBe("Second rôle")
  })

  it("rethrows a 401 from an unread count", async () => {
    routeFetch({ "/messages/unread": statusResponse(401, "Unauthorized") })

    await expect(adapter.fetchStats(HOST, CREDENTIALS, "/auth/me")).rejects.toBeInstanceOf(
      SessionExpiredError
    )
  })

  it("leaves the class empty when gamification is unavailable", async () => {
    routeFetch({ "/me/gamification": new TypeError("fetch failed") })

    const stats = await adapter.fetchStats(HOST, CREDENTIALS, "/auth/me")

    expect(stats.group).toBeNull()
  })

  it("leaves the class empty for a blank rank label", async () => {
    routeFetch({ "/me/gamification": jsonResponse({ ...GAME, rank: { key: "x", label: "  " } }) })

    const stats = await adapter.fetchStats(HOST, CREDENTIALS, "/auth/me")

    expect(stats.group).toBeNull()
  })

  it("turns a 401 into a session-expired error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(statusResponse(401, "Unauthorized"))

    await expect(adapter.fetchStats(HOST, CREDENTIALS, "/auth/me")).rejects.toBeInstanceOf(
      SessionExpiredError
    )
  })

  it("rethrows a 401 from the gamification call", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(jsonResponse(ME))
      .mockResolvedValueOnce(statusResponse(401, "Unauthorized"))

    await expect(adapter.fetchStats(HOST, CREDENTIALS, "/auth/me")).rejects.toBeInstanceOf(
      SessionExpiredError
    )
  })

  it("fails a 403 as an ordinary error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(statusResponse(403, "Forbidden"))

    const err = await adapter.fetchStats(HOST, CREDENTIALS, "/auth/me").catch((e: unknown) => e)

    expect(err).not.toBeInstanceOf(SessionExpiredError)
    expect((err as Error).message).toBe("Tracker API error: 403 Forbidden")
  })

  it("returns every raw payload for the debug view", async () => {
    routeFetch()

    const calls = await adapter.fetchRaw(HOST, CREDENTIALS, "/auth/me")

    expect(calls).toEqual([
      { label: "Me", endpoint: "/auth/me", data: ME, error: null },
      { label: "Gamification", endpoint: "/me/gamification", data: GAME, error: null },
      {
        label: "Notifications",
        endpoint: "/notifications/unread-count",
        data: { unread: 3 },
        error: null,
      },
      { label: "Messages", endpoint: "/messages/unread", data: { count: 2 }, error: null },
      {
        label: "Conversations",
        endpoint: "/conversations/unread",
        data: { count: 1 },
        error: null,
      },
      { label: "Seeding", endpoint: SEEDS_SEEDING, data: FIXTURES[SEEDS_SEEDING], error: null },
      { label: "Leeching", endpoint: SEEDS_LEECHING, data: FIXTURES[SEEDS_LEECHING], error: null },
      { label: "Warnings", endpoint: "/me/warnings", data: FIXTURES["/me/warnings"], error: null },
      { label: "Profile", endpoint: "/users/testuser", data: PROFILE, error: null },
    ])
  })

  it("flags an unread count the poll would skip", async () => {
    routeFetch({ "/messages/unread": jsonResponse({}) })

    const calls = await adapter.fetchRaw(HOST, CREDENTIALS, "/auth/me")

    expect(calls[3].error).toBe(
      "Unexpected response from api.v3x.club: missing count in /messages/unread"
    )
  })

  it("flags a seed list without a total and a warnings body without a list", async () => {
    routeFetch({
      [SEEDS_LEECHING]: jsonResponse({ rows: [] }),
      "/me/warnings": jsonResponse({ threshold: 3 }),
    })

    const calls = await adapter.fetchRaw(HOST, CREDENTIALS, "/auth/me")

    expect(calls[6].error).toBe(
      `Unexpected response from api.v3x.club: missing total in ${SEEDS_LEECHING}`
    )
    expect(calls[7].error).toBe(
      "Unexpected response from api.v3x.club: missing warnings in /me/warnings"
    )
  })

  it("skips the profile when /auth/me fails", async () => {
    routeFetch({ "/auth/me": statusResponse(500, "Internal Server Error") })

    const calls = await adapter.fetchRaw(HOST, CREDENTIALS, "/auth/me")

    expect(calls.map((c) => c.label)).not.toContain("Profile")
  })

  it("flags a /auth/me body the poll would fail, and still reads gamification", async () => {
    routeFetch({ "/auth/me": jsonResponse({ ...ME, uploaded: undefined }) })

    const calls = await adapter.fetchRaw(HOST, CREDENTIALS, "/auth/me")

    expect(calls[0].error).toBe("Unexpected response from api.v3x.club: missing uploaded")
    expect(calls[1]).toMatchObject({ label: "Gamification", data: GAME, error: null })
  })

  it("adds the gamification entry when /auth/me fails", async () => {
    routeFetch({ "/auth/me": statusResponse(500, "Internal Server Error") })

    const calls = await adapter.fetchRaw(HOST, CREDENTIALS, "/auth/me")

    expect(calls[0]).toMatchObject({
      label: "Me",
      data: null,
      error: "Tracker API error: 500 Internal Server Error",
    })
    expect(calls[1]).toMatchObject({ label: "Gamification", data: GAME, error: null })
  })
})

describe("parseV3xProfile", () => {
  it("reads the user ID, last login, invites and bonus upload", () => {
    expect(parseV3xProfile(PROFILE)).toEqual({
      remoteUserId: 4242,
      lastAccessDate: "2026-10-25T08:00:00.000Z",
      meta: { invites: 2, bonusUploadedBytes: 10737418240 },
    })
  })

  it("leaves out an ID that is not a positive integer", () => {
    expect(parseV3xProfile({ ...PROFILE, id: "abc" as unknown as number }).remoteUserId).toBe(
      undefined
    )
  })

  it("fails on a body without a profile object", () => {
    expect(() => parseV3xProfile(null)).toThrow(
      "Unexpected response from api.v3x.club: missing profile object"
    )
  })
})
