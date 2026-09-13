// src/lib/download-clients/__tests__/qbt-transport.test.ts
//
// The transport turns fetch failures into "Failed to connect" errors that the
// scheduler logs raw, so what it copies out of an error is what ends up on disk.

import { afterEach, describe, expect, it, vi } from "vitest"
import {
  clearAllSessions,
  clearAuthBlocks,
  getSession,
  invalidateSession,
  login,
} from "@/lib/download-clients/qbt/transport"

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

describe("qBittorrent session cookie validation", () => {
  // authHeaders interpolates the SID value straight into a Cookie header.
  // undici rejects CR and LF inside a parsed response header, so a real server
  // cannot deliver one, which is why the response is faked here rather than
  // built with Response: the guard exists because that protection lives in a
  // dependency rather than in this file.
  function loginRespondingWith(setCookie: string[]) {
    return vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "Ok.",
      headers: { getSetCookie: () => setCookie },
    } as unknown as Response)
  }

  it("refuses a session cookie carrying a control character", async () => {
    vi.stubGlobal("fetch", loginRespondingWith(["SID=abc\r\nX-Injected: 1; Path=/"]))

    await expect(login("qbt.local", 8080, false, "admin", "pw")).rejects.toThrow(
      "unsafe character"
    )
  })

  it("accepts an ordinary session cookie", async () => {
    vi.stubGlobal("fetch", loginRespondingWith(["QBT_SID_8080=abc123def456; Path=/; HttpOnly"]))

    const sid = await login("qbt.local", 8080, false, "admin", "pw")
    expect(sid).toEqual({ name: "QBT_SID_8080", value: "abc123def456" })
  })

  it("ignores an unrelated Set-Cookie rather than failing the login", async () => {
    vi.stubGlobal(
      "fetch",
      loginRespondingWith(["analytics=x; Path=/", "SID=cleanvalue; Path=/"])
    )

    const sid = await login("qbt.local", 8080, false, "admin", "pw")
    expect(sid.value).toBe("cleanvalue")
  })
})

describe("qBittorrent session cache keying", () => {
  // Two client rows can point at one host with different accounts. Keyed by
  // baseUrl alone, the second row rode the first row's session, so its own
  // credentials were never sent and a revoked password still polled green.
  function loginOnce(sid: string) {
    return vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "Ok.",
      headers: { getSetCookie: () => [`SID=${sid}; Path=/`] },
    } as unknown as Response)
  }

  it("does not hand one account the session minted for another", async () => {
    const first = loginOnce("session-for-alice")
    vi.stubGlobal("fetch", first)
    const alice = await getSession("qbt.local", 8080, false, "alice", "pw-a")
    expect(alice.sid.value).toBe("session-for-alice")

    const second = loginOnce("session-for-bob")
    vi.stubGlobal("fetch", second)
    const bob = await getSession("qbt.local", 8080, false, "bob", "pw-b")

    // Bob must have logged in rather than reusing the cached entry.
    expect(second).toHaveBeenCalledTimes(1)
    expect(bob.sid.value).toBe("session-for-bob")
  })

  it("reuses the session for the same credentials", async () => {
    const fetchMock = loginOnce("session-once")
    vi.stubGlobal("fetch", fetchMock)

    await getSession("qbt.local", 8080, false, "alice", "pw-a")
    await getSession("qbt.local", 8080, false, "alice", "pw-a")

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("drops every session for a host when one is invalidated", async () => {
    vi.stubGlobal("fetch", loginOnce("a"))
    await getSession("qbt.local", 8080, false, "alice", "pw-a")
    vi.stubGlobal("fetch", loginOnce("b"))
    await getSession("qbt.local", 8080, false, "bob", "pw-b")

    invalidateSession("http://qbt.local:8080")

    const after = loginOnce("fresh")
    vi.stubGlobal("fetch", after)
    await getSession("qbt.local", 8080, false, "alice", "pw-a")
    expect(after).toHaveBeenCalledTimes(1)
  })
})
