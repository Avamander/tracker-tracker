// src/lib/__tests__/tracker-inbox.test.ts

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
}))

import { db } from "@/lib/db"
import { trackerMessages, trackerNews, trackers } from "@/lib/db/schema"
import { pruneTrackerInbox, recordTrackerInbox } from "@/lib/tracker-inbox"

interface Call {
  op: "insert" | "update" | "delete"
  table: unknown
  method: string
  args: unknown[]
}

let calls: Call[] = []

function chain(op: Call["op"], table: unknown, result: unknown): Record<string, unknown> {
  const settled = Promise.resolve(result)
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return settled.then.bind(settled)
        if (prop === "catch") return settled.catch.bind(settled)
        if (prop === "finally") return settled.finally.bind(settled)
        return (...args: unknown[]) => {
          calls.push({ op, table, method: String(prop), args })
          return proxy
        }
      },
    }
  )
  return proxy
}

const find = (op: Call["op"], table: unknown, method: string) =>
  calls.filter((c) => c.op === op && c.table === table && c.method === method)

const NOW = new Date("2026-09-29T12:00:00Z")

beforeEach(() => {
  calls = []
  vi.mocked(db.insert).mockImplementation(((t: unknown) => chain("insert", t, [])) as never)
  vi.mocked(db.update).mockImplementation(((t: unknown) => chain("update", t, [])) as never)
  vi.mocked(db.delete).mockImplementation(((t: unknown) =>
    chain("delete", t, [{ id: 1 }])) as never)
})

describe("recordTrackerInbox", () => {
  it("stores the counts, deriving missing ones from the listed messages", async () => {
    await recordTrackerInbox(
      7,
      {
        unreadMessages: null,
        unreadStaffMessages: null,
        unreadNotifications: 3,
        messages: [
          { id: "1", subject: "Hi", sender: "alice" },
          { id: "2", subject: "Ticket", sender: "staff", staff: true },
        ],
        links: { inbox: "https://t.example/inbox" },
      },
      { storeUsernames: true, now: NOW }
    )

    expect(find("update", trackers, "set")[0].args[0]).toEqual({
      unreadMessages: 1,
      unreadStaffMessages: 1,
      unreadNotifications: 3,
      inboxCheckedAt: NOW,
      inboxLinks: { inbox: "https://t.example/inbox" },
    })
  })

  it("keeps reported counts over the listed messages", async () => {
    await recordTrackerInbox(
      7,
      {
        unreadMessages: 5,
        unreadStaffMessages: 0,
        unreadNotifications: null,
        messages: [{ id: "1", subject: "Hi", sender: "alice" }],
      },
      { storeUsernames: true, now: NOW }
    )

    expect(find("update", trackers, "set")[0].args[0]).toMatchObject({ unreadMessages: 5 })
  })

  it("upserts listed messages and masks senders when usernames are not stored", async () => {
    await recordTrackerInbox(
      7,
      {
        unreadMessages: null,
        unreadStaffMessages: null,
        unreadNotifications: null,
        messages: [{ id: "9", subject: "Hello", sender: "alice", sentAt: "2026-09-28T10:00:00Z" }],
      },
      { storeUsernames: false, now: NOW }
    )

    const [values] = find("insert", trackerMessages, "values")
    expect(values.args[0]).toMatchObject({
      trackerId: 7,
      remoteId: "9",
      subject: "Hello",
      sender: "▓5",
      sentAt: new Date("2026-09-28T10:00:00Z"),
      readAt: null,
    })
    expect(find("insert", trackerMessages, "onConflictDoUpdate")).toHaveLength(1)
  })

  it("marks messages that are no longer listed as read", async () => {
    await recordTrackerInbox(
      7,
      { unreadMessages: 0, unreadStaffMessages: 0, unreadNotifications: null, messages: [] },
      { storeUsernames: true, now: NOW }
    )

    expect(find("update", trackerMessages, "set")[0].args[0]).toEqual({ readAt: NOW })
  })

  it("does not touch messages when the tracker lists none", async () => {
    await recordTrackerInbox(
      7,
      { unreadMessages: 2, unreadStaffMessages: null, unreadNotifications: null },
      { storeUsernames: true, now: NOW }
    )

    expect(find("insert", trackerMessages, "values")).toHaveLength(0)
    expect(find("update", trackerMessages, "set")).toHaveLength(0)
  })

  it("inserts news once per tracker, kind and item, dismissing kinds the site has read", async () => {
    await recordTrackerInbox(
      7,
      {
        unreadMessages: null,
        unreadStaffMessages: null,
        unreadNotifications: null,
        news: [
          { id: "1", kind: "announcement", title: "Site news" },
          { id: "1", kind: "blog", title: "Blog post" },
        ],
        newsSeenOnSite: { blog: true },
      },
      { storeUsernames: true, now: NOW }
    )

    const values = find("insert", trackerNews, "values").map((c) => c.args[0])
    expect(values).toEqual([
      expect.objectContaining({ kind: "announcement", dismissedAt: null }),
      expect.objectContaining({ kind: "blog", dismissedAt: NOW }),
    ])
    const [conflict] = find("insert", trackerNews, "onConflictDoNothing")
    expect((conflict.args[0] as { target: unknown[] }).target).toHaveLength(3)
    expect(find("update", trackerNews, "set")[0].args[0]).toEqual({ dismissedAt: NOW })
  })

  it("leaves news alone when no kind is reported read", async () => {
    await recordTrackerInbox(
      7,
      { unreadMessages: null, unreadStaffMessages: null, unreadNotifications: null, news: [] },
      { storeUsernames: true, now: NOW }
    )

    expect(find("update", trackerNews, "set")).toHaveLength(0)
  })
})

describe("pruneTrackerInbox", () => {
  it("deletes only read messages and dismissed news", async () => {
    const pruned = await pruneTrackerInbox(30)

    expect(pruned).toBe(2)
    expect(find("delete", trackerMessages, "where")).toHaveLength(1)
    expect(find("delete", trackerNews, "where")).toHaveLength(1)
  })
})
