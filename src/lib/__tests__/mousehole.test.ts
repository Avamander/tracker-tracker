// src/lib/__tests__/mousehole.test.ts

import { describe, expect, it } from "vitest"
import { mouseholeStatus, parseMouseholeUrl, stripUrlCredentials } from "@/lib/mousehole"

describe("parseMouseholeUrl", () => {
  it("takes the token from the userinfo password and strips it from the base", () => {
    expect(parseMouseholeUrl("http://:s3cret@protonvpn:5010/")).toEqual({
      baseUrl: "http://protonvpn:5010",
      token: "s3cret",
    })
  })

  it("accepts the token as the username too", () => {
    expect(parseMouseholeUrl("http://s3cret@protonvpn:5010").token).toBe("s3cret")
  })

  it("decodes percent-encoded tokens", () => {
    expect(parseMouseholeUrl("http://:a%2Fb%40c@host:5010").token).toBe("a/b@c")
  })

  it("has no token when the URL carries none", () => {
    expect(parseMouseholeUrl("http://host:5010")).toEqual({
      baseUrl: "http://host:5010",
      token: null,
    })
  })

  it("throws on an unparseable URL", () => {
    expect(() => parseMouseholeUrl("not a url")).toThrow()
  })
})

describe("stripUrlCredentials", () => {
  it("removes userinfo so the URL is safe to link", () => {
    expect(stripUrlCredentials("https://user:pw@mousehole.example.org/")).toBe(
      "https://mousehole.example.org"
    )
  })

  it("returns an empty string for an unparseable URL", () => {
    expect(stripUrlCredentials("::")).toBe("")
  })
})

describe("mouseholeStatus", () => {
  it("maps each contact result to a label and tone", () => {
    expect(mouseholeStatus("ok")).toEqual({ label: "OK", tone: "success" })
    expect(mouseholeStatus("throttled").tone).toBe("warn")
    expect(mouseholeStatus("no-cookie").tone).toBe("warn")
    expect(mouseholeStatus("pending").tone).toBe("warn")
    expect(mouseholeStatus("rejected").tone).toBe("danger")
    expect(mouseholeStatus("unreachable").tone).toBe("danger")
    expect(mouseholeStatus(null)).toEqual({ label: "Down", tone: "danger" })
  })
})
