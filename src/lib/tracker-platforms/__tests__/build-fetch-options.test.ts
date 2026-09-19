// src/lib/tracker-platforms/__tests__/build-fetch-options.test.ts
//
// buildFetchOptions is the only wiring between a registry entry and the
// per-tracker auth spellings the adapters read, so the lookup it uses is
// pinned here rather than inside any adapter.

import { describe, expect, it } from "vitest"
import { buildFetchOptions } from "@/lib/tracker-platforms"

describe("buildFetchOptions registry lookup", () => {
  it("gives Anthelion the apikey spelling for a base URL saved with another scheme", () => {
    expect(buildFetchOptions("http://anthelion.me").nebulanceAuthParam).toBe("apikey")
  })

  it("gives Anthelion the apikey spelling for a base URL saved with a www prefix", () => {
    expect(buildFetchOptions("https://www.anthelion.me").nebulanceAuthParam).toBe("apikey")
  })

  it("gives Anthelion the apikey spelling for a base URL saved with a path", () => {
    expect(buildFetchOptions("https://anthelion.me/index.php").nebulanceAuthParam).toBe("apikey")
  })

  it("leaves the auth param unset for a nebulance host the registry does not spell out", () => {
    expect(buildFetchOptions("https://nebulance.io").nebulanceAuthParam).toBeUndefined()
  })

  it("leaves every registry option unset for a host that is not in the registry", () => {
    expect(buildFetchOptions("https://not-a-tracker.example")).toEqual({})
  })

  it("resolves the gazelle and unit3d auth styles through the same hostname lookup", () => {
    expect(buildFetchOptions("http://www.redacted.sh/index.php").authStyle).toBe("raw")
    expect(buildFetchOptions("http://www.blutopia.cc/index.php").unit3dAuthStyle).toBe("bearer")
  })

  it("keeps the caller's infrastructure options alongside the registry ones", () => {
    expect(buildFetchOptions("https://anthelion.me", { remoteUserId: 7 })).toMatchObject({
      remoteUserId: 7,
      nebulanceAuthParam: "apikey",
    })
  })
})
