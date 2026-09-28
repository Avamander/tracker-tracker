// src/app/api/inbox/inbox-routes.test.ts

import { NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { authenticate, parseJsonBody } from "@/lib/api-helpers"
import { dismissNews, getInbox } from "@/lib/tracker-inbox"
import { POST } from "./news/route"
import { GET } from "./route"

vi.mock("@/lib/api-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-helpers")>()
  return { ...actual, authenticate: vi.fn(), parseJsonBody: vi.fn() }
})
vi.mock("@/lib/privacy-db", () => ({ createPrivacyMask: vi.fn(async () => (v: unknown) => v) }))
vi.mock("@/lib/tracker-inbox", () => ({
  getInbox: vi.fn(async () => []),
  dismissNews: vi.fn(async () => 2),
}))

const get = (query = "") => GET(new Request(`http://localhost/api/inbox${query}`))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticate).mockResolvedValue({ encryptionKey: "k" })
})

describe("GET /api/inbox", () => {
  it("rejects unauthenticated requests", async () => {
    vi.mocked(authenticate).mockResolvedValue(NextResponse.json({}, { status: 401 }))
    expect((await get()).status).toBe(401)
  })

  it("returns every tracker's inbox, or one tracker's", async () => {
    expect(await (await get()).json()).toEqual({ trackers: [] })
    expect(vi.mocked(getInbox).mock.calls[0][1]).toBeUndefined()

    await get("?trackerId=3")
    expect(vi.mocked(getInbox).mock.calls[1][1]).toBe(3)
  })

  it("rejects a malformed tracker ID", async () => {
    expect((await get("?trackerId=abc")).status).toBe(400)
  })
})

describe("POST /api/inbox/news", () => {
  const post = (body: Record<string, unknown>) => {
    vi.mocked(parseJsonBody).mockResolvedValue(body)
    return POST(new Request("http://localhost/api/inbox/news", { method: "POST" }))
  }

  it("dismisses the given news", async () => {
    const res = await post({ ids: [1, 2] })
    expect(await res.json()).toEqual({ dismissed: 2 })
    expect(dismissNews).toHaveBeenCalledWith({ ids: [1, 2], trackerId: undefined })
  })

  it("dismisses all of a tracker's news", async () => {
    await post({ trackerId: 4 })
    expect(dismissNews).toHaveBeenCalledWith({ ids: undefined, trackerId: 4 })
  })

  it("rejects invalid ids", async () => {
    expect((await post({ ids: ["x"] })).status).toBe(400)
    expect((await post({ trackerId: -1 })).status).toBe(400)
    expect(dismissNews).not.toHaveBeenCalled()
  })
})
