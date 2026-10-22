// src/app/api/trackers/captcha-route.test.ts

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-helpers")>()
  return {
    ...actual,
    authenticate: vi.fn(async () => ({ encryptionKey: "a".repeat(64) })),
    decodeKey: vi.fn(() => Buffer.alloc(32)),
  }
})
vi.mock("@/lib/db", () => ({ db: { select: vi.fn() } }))
vi.mock("@/lib/crypto", () => ({ decrypt: vi.fn(() => "token") }))
vi.mock("@/lib/logger", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock("@/lib/flaresolverr-config", () => ({
  flareSolverrFor: vi.fn(async () => ({ url: "http://flaresolverr:8191", maxTimeout: 60000 })),
}))
vi.mock("@/lib/manual-poll", () => ({ runManualPoll: vi.fn(async () => ({ ok: true })) }))

const pendingCaptcha = vi.fn()
const submitCaptcha = vi.fn()
vi.mock("@/lib/tracker-platforms", () => ({
  getAdapter: vi.fn((platform: string) =>
    platform === "rutracker" ? { pendingCaptcha, submitCaptcha } : {}
  ),
  buildFetchOptions: vi.fn((opts: Record<string, unknown>) => ({
    flaresolverr: opts.flaresolverr,
  })),
}))

import { db } from "@/lib/db"
import { runManualPoll } from "@/lib/manual-poll"
import { GET, POST } from "./[id]/captcha/route"

function selectTracker(platformType = "rutracker") {
  const row = {
    name: "RuTracker",
    baseUrl: "https://rutracker.org",
    platformType,
    registrySlug: "rutracker",
    encryptedApiToken: "enc",
    isActive: true,
    useFlaresolverr: true,
    remoteUserId: 1234,
  }
  const limit = vi.fn().mockResolvedValue([row])
  const where = vi.fn().mockReturnValue({ limit })
  const from = vi.fn().mockReturnValue({ where })
  vi.mocked(db.select).mockReturnValue({ from } as never)
}

const props = { params: Promise.resolve({ id: "1" }) }
const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/trackers/1/captcha", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    props
  )

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  selectTracker()
})

describe("GET /api/trackers/[id]/captcha", () => {
  it("reports no captcha when none is pending", async () => {
    pendingCaptcha.mockResolvedValue(null)
    const res = await GET(new Request("http://localhost"), props)
    expect(await res.json()).toEqual({ pending: false })
  })

  it("inlines the image, fetched by the server, for the poll's URL", async () => {
    pendingCaptcha.mockResolvedValue({
      imageUrl: "https://static.rutracker.cc/captcha/0000.jpg",
      expiresAt: "2026-10-22T12:10:00.000Z",
    })
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/jpeg" } })
      )

    const res = await GET(new Request("http://localhost"), props)

    expect(pendingCaptcha).toHaveBeenCalledWith("https://rutracker.org", "token")
    expect(await res.json()).toEqual({
      pending: true,
      image: "data:image/jpeg;base64,AQID",
      expiresAt: "2026-10-22T12:10:00.000Z",
    })
    const init = fetchSpy.mock.calls[0][1] as RequestInit
    expect(init.headers).toBeUndefined()
  })

  it("returns no image for a response that is not an image", async () => {
    pendingCaptcha.mockResolvedValue({
      imageUrl: "https://static.rutracker.cc/captcha/0000.jpg",
      expiresAt: "2026-10-22T12:10:00.000Z",
    })
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("<html></html>", { headers: { "Content-Type": "text/html" } })
    )
    const res = await GET(new Request("http://localhost"), props)
    expect((await res.json()).image).toBeNull()
  })

  it("returns 404 for a tracker without captchas", async () => {
    selectTracker("unit3d")
    expect((await GET(new Request("http://localhost"), props)).status).toBe(404)
  })
})

describe("POST /api/trackers/[id]/captcha", () => {
  it("submits the trimmed answer through FlareSolverr, then polls", async () => {
    submitCaptcha.mockResolvedValue(undefined)

    const res = await post({ answer: " x7k2 " })

    expect(submitCaptcha).toHaveBeenCalledWith(
      "https://rutracker.org",
      "token",
      "x7k2",
      expect.objectContaining({ flaresolverr: expect.any(Object) })
    )
    expect(runManualPoll).toHaveBeenCalled()
    expect(await res.json()).toEqual({ success: true, polled: true })
  })

  it("returns 422 with the reason for a wrong answer", async () => {
    submitCaptcha.mockRejectedValue(new Error("Wrong captcha, try the new one"))
    const res = await post({ answer: "nope" })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: "Wrong captcha, try the new one" })
    expect(runManualPoll).not.toHaveBeenCalled()
  })

  it.each([{ answer: "" }, { answer: "x".repeat(33) }, {}])("rejects %j", async (body) => {
    expect((await post(body)).status).toBe(400)
  })
})
