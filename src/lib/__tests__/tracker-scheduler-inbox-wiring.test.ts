// src/lib/__tests__/tracker-scheduler-inbox-wiring.test.ts

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
}))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock("@/lib/tracker-inbox", () => ({
  recordTrackerInbox: vi.fn(async () => {}),
  pruneTrackerInbox: vi.fn(async () => 0),
}))
vi.mock("@/lib/tracker-outages", () => ({
  recordTrackerPollFailure: vi.fn(async () => {}),
  pruneTrackerOutages: vi.fn(async () => 0),
}))
vi.mock("@/lib/app-liveness", () => ({ pruneCoverageGaps: vi.fn(async () => 0) }))
vi.mock("@/lib/crypto", () => ({ decrypt: vi.fn(() => "token") }))
vi.mock("@/lib/notifications/dispatch", () => ({ dispatchNotifications: vi.fn(async () => {}) }))
vi.mock("@/lib/alert-pruning", () => ({ pruneDismissedAlerts: vi.fn(async () => 0) }))
vi.mock("@/lib/server-data", () => ({ recordDatabaseSize: vi.fn(async () => {}) }))
vi.mock("@/lib/tunnel", () => ({ buildProxyAgentFromSettings: vi.fn(() => undefined) }))
vi.mock("@/data/tracker-registry", () => ({ findRegistryEntry: vi.fn(() => null) }))
vi.mock("node-cron", () => ({ default: { schedule: vi.fn() } }))

const fetchStats = vi.fn()
vi.mock("@/lib/adapters", () => ({
  getAdapter: vi.fn(() => ({ fetchStats })),
  buildFetchOptions: vi.fn(() => ({})),
}))

import { db } from "@/lib/db"
import { recordTrackerInbox } from "@/lib/tracker-inbox"
import { pollTracker } from "@/lib/tracker-scheduler"

/** Drizzle-shaped chain: any method sequence resolves to `result`. */
function chain(result: unknown): Record<string, unknown> {
  const settled = Promise.resolve(result)
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return settled.then.bind(settled)
        if (prop === "catch") return settled.catch.bind(settled)
        if (prop === "finally") return settled.finally.bind(settled)
        return () => proxy
      },
    }
  )
  return proxy
}

const TRACKER_ROW = {
  id: 42,
  name: "Example",
  isActive: true,
  encryptedApiToken: "enc",
  platformType: "unit3d",
  baseUrl: "https://example.test",
  apiPath: "/api",
  useProxy: false,
  remoteUserId: null,
  joinedAt: null,
  platformMeta: null,
  lastPolledAt: null,
  lastError: null,
  lastErrorAt: null,
  consecutiveFailures: 0,
  pausedAt: null,
  userPausedAt: null,
  minimumRatio: null,
}

const STATS = {
  uploadedBytes: 1_000n,
  downloadedBytes: 500n,
  ratio: 2,
  seedbonus: null,
  hitAndRuns: null,
  seedingCount: null,
  leechingCount: null,
  requiredRatio: null,
  warned: null,
  freeleechTokens: null,
  shareScore: null,
  username: null,
  group: null,
  remoteUserId: null,
  joinedDate: null,
  lastAccessDate: null,
  platformMeta: null,
  avatarUrl: null,
}

/**
 * `db.select(cols)` answers by projection: the tracker row for the poll's own
 * lookup, and nothing for every other read (previous snapshot, checkpoints).
 */
function seedDb() {
  vi.mocked(db.select).mockImplementation(((cols: Record<string, unknown>) => {
    const keys = Object.keys(cols ?? {})
    if (keys.includes("encryptedApiToken")) return chain([TRACKER_ROW])
    return chain([])
  }) as never)
  vi.mocked(db.insert).mockImplementation((() => chain([])) as never)
  vi.mocked(db.update).mockImplementation((() =>
    chain([{ consecutiveFailures: 1, pausedAt: null }])) as never)
  vi.mocked(db.delete).mockImplementation((() => chain([])) as never)
}

const KEY = Buffer.alloc(32)

beforeEach(() => {
  vi.clearAllMocks()
  seedDb()
})

describe("pollTracker → tracker inbox", () => {
  const INBOX = { unreadMessages: 2, unreadStaffMessages: 0, unreadNotifications: null }

  it("records the inbox a successful poll returns", async () => {
    fetchStats.mockResolvedValue({ ...STATS, inbox: INBOX })

    await pollTracker(42, KEY, false)

    expect(recordTrackerInbox).toHaveBeenCalledWith(
      42,
      INBOX,
      expect.objectContaining({ storeUsernames: true })
    )
  })

  it("masks senders when usernames are not stored", async () => {
    fetchStats.mockResolvedValue({ ...STATS, inbox: INBOX })

    await pollTracker(42, KEY, true)

    expect(recordTrackerInbox).toHaveBeenCalledWith(
      42,
      INBOX,
      expect.objectContaining({ storeUsernames: false })
    )
  })

  it("leaves the stored inbox alone when the tracker reports none", async () => {
    fetchStats.mockResolvedValue(STATS)

    await pollTracker(42, KEY, false)

    expect(recordTrackerInbox).not.toHaveBeenCalled()
  })

  it("still records the snapshot when inbox recording fails", async () => {
    fetchStats.mockResolvedValue({ ...STATS, inbox: INBOX })
    vi.mocked(recordTrackerInbox).mockRejectedValueOnce(new Error("db down"))

    await pollTracker(42, KEY, false)

    expect(db.insert).toHaveBeenCalled()
  })
})
