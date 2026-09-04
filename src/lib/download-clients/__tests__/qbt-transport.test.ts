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
