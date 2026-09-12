// src/lib/download-clients/__tests__/qbt-transport.test.ts
//
// The transport turns fetch failures into "Failed to connect" errors that the
// scheduler logs raw, so what it copies out of an error is what ends up on disk.

import { afterEach, describe, expect, it, vi } from "vitest"
import { clearAllSessions, clearAuthBlocks, login } from "@/lib/download-clients/qbt/transport"

const BASE = "http://qbt.local:8080"

afterEach(() => {
  vi.unstubAllGlobals()
  clearAllSessions()
  clearAuthBlocks(BASE)
})

describe("qBittorrent transport connection errors", () => {
  it("never copies a header-validation TypeError, which quotes the credential", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          new TypeError('Headers.append: "Bearer SECRETKEY" is an invalid header value.')
        )
    )
    const attempt = login("qbt.local", 8080, false, "admin", "pw")
    await expect(attempt).rejects.toThrow(`Failed to connect to ${BASE}: TypeError`)
    await expect(login("qbt.local", 8080, false, "admin", "pw")).rejects.not.toThrow("SECRETKEY")
  })

  it("still reports the cause code when fetch wraps one", async () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause })))
    await expect(login("qbt.local", 8080, false, "admin", "pw")).rejects.toThrow(
      `Failed to connect to ${BASE}: ECONNREFUSED`
    )
  })
})

describe("qBittorrent transport redirect handling", () => {
  // The login body carries the password in the clear. fetch() follows
  // redirects by default and a 307 replays the body at the new origin, so
  // before `redirect: "manual"` a host answering 307 collected the password
  // from whatever origin its Location named.
  it("refuses a redirect rather than replaying the password at a new origin", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 307,
        headers: { Location: "http://attacker.example/collect" },
      })
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(login("qbt.local", 8080, false, "admin", "S3CR3T-PW")).rejects.toThrow(
      "qBittorrent API error: 307"
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" })
  })

  it("does not latch the credential block on a redirect, which is not a rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, { status: 302, headers: { Location: "/elsewhere" } })
      )
    )
    await expect(login("qbt.local", 8080, false, "admin", "pw")).rejects.toThrow(
      "qBittorrent API error: 302"
    )
    // A latched block would replay the rejection message instead of retrying.
    await expect(login("qbt.local", 8080, false, "admin", "pw")).rejects.toThrow(
      "qBittorrent API error: 302"
    )
  })
})
