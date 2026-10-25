// src/lib/__tests__/prowlarr-client.test.ts
//
// Fixtures follow the shapes Prowlarr v1 returns, with invented values.

// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest"
import {
  fetchIndexerStatuses,
  fetchIndexers,
  fetchSystemStatus,
  normalizeProwlarrUrl,
  parseIndexerStatuses,
  parseIndexers,
  parseSystemStatus,
  prowlarrUrlError,
  sanitizeProwlarrError,
} from "@/lib/prowlarr/client"

const CONN = { url: "http://prowlarr.test:9696", apiKey: "0123456789abcdef0123456789abcdef" }

const INDEXER = {
  id: 12,
  name: "Example Indexer",
  definitionName: "exampleindexer",
  enable: true,
  protocol: "torrent",
  privacy: "private",
  indexerUrls: ["https://example.org/", "https://www.example-mirror.org/"],
  legacyUrls: ["https://old-example.org/"],
  fields: [
    { name: "definitionFile", value: "exampleindexer" },
    { name: "baseUrl", value: "https://www.example.org/" },
    { name: "username", value: "should-not-be-read" },
    { name: "password", value: "********" },
  ],
  tags: [],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("parseIndexers", () => {
  it("keeps identity, state and hostnames, and none of the other settings", () => {
    const [parsed] = parseIndexers([INDEXER])
    expect(parsed).toEqual({
      indexerId: 12,
      name: "Example Indexer",
      enabled: true,
      hosts: ["example.org", "example-mirror.org", "old-example.org"],
    })
    expect(JSON.stringify(parsed)).not.toContain("should-not-be-read")
  })

  it("handles a null baseUrl and a disabled indexer", () => {
    const [parsed] = parseIndexers([
      { ...INDEXER, enable: false, fields: [{ name: "baseUrl", value: null }], legacyUrls: [] },
    ])
    expect(parsed.enabled).toBe(false)
    expect(parsed.hosts).toEqual(["example.org", "example-mirror.org"])
  })

  it("skips malformed entries and rejects a non-array body", () => {
    expect(parseIndexers([{ id: "x", name: "Broken" }, null, INDEXER])).toHaveLength(1)
    expect(() => parseIndexers({ records: [] })).toThrow(/unexpected indexer response/)
  })
})

describe("parseIndexerStatuses", () => {
  it("parses dates and drops entries without an indexer id", () => {
    const parsed = parseIndexerStatuses([
      {
        indexerId: 12,
        disabledTill: "2026-05-02T10:00:00Z",
        mostRecentFailure: "2026-05-01T10:00:00Z",
        initialFailure: "2026-04-28T08:30:00Z",
      },
      { disabledTill: "2026-05-02T10:00:00Z" },
    ])
    expect(parsed).toEqual([
      {
        indexerId: 12,
        disabledTill: new Date("2026-05-02T10:00:00Z"),
        mostRecentFailure: new Date("2026-05-01T10:00:00Z"),
        initialFailure: new Date("2026-04-28T08:30:00Z"),
      },
    ])
  })

  it("reads a missing or invalid date as null", () => {
    const [parsed] = parseIndexerStatuses([{ indexerId: 3, disabledTill: "not a date" }])
    expect(parsed.disabledTill).toBeNull()
    expect(parsed.initialFailure).toBeNull()
  })
})

describe("parseSystemStatus", () => {
  it("reads the version", () => {
    expect(parseSystemStatus({ appName: "Prowlarr", version: "1.2.3.4567" })).toEqual({
      version: "1.2.3.4567",
    })
    expect(() => parseSystemStatus("nope")).toThrow()
  })
})

describe("prowlarrUrlError and normalizeProwlarrUrl", () => {
  it("allows local and private addresses", () => {
    expect(prowlarrUrlError("http://prowlarr.test:9696")).toBeNull()
    expect(prowlarrUrlError("http://192.168.1.20:9696/prowlarr")).toBeNull()
  })

  it("refuses other schemes, userinfo, queries and garbage", () => {
    expect(prowlarrUrlError("ftp://prowlarr")).toMatch(/http/)
    expect(prowlarrUrlError("http://user:pass@prowlarr.test:9696")).toMatch(/username or password/)
    expect(prowlarrUrlError("http://prowlarr.test:9696/?apikey=x")).toMatch(/query/)
    expect(prowlarrUrlError("prowlarr")).toBe("Invalid URL format")
  })

  it("strips trailing slashes so a URL base keeps its path", () => {
    expect(normalizeProwlarrUrl(" http://host.test/prowlarr// ")).toBe("http://host.test/prowlarr")
  })
})

describe("sanitizeProwlarrError", () => {
  it("words this client's own failures", () => {
    expect(sanitizeProwlarrError("Prowlarr API error: 401")).toBe("API key rejected by Prowlarr")
    expect(sanitizeProwlarrError("Prowlarr API error: 302")).toMatch(/redirected/)
    expect(sanitizeProwlarrError("Prowlarr API error: 404")).toMatch(/URL base/)
    expect(sanitizeProwlarrError("Prowlarr API error: 500")).toBe("Prowlarr returned HTTP 500")
    expect(sanitizeProwlarrError("Prowlarr sent a response that is not JSON")).toBe(
      "Prowlarr returned an unexpected response"
    )
  })

  // A rejected or missing key and a wrong URL base are not worded as unreachable.
  it("words only network faults as unreachable, through the shared sanitizer", () => {
    expect(sanitizeProwlarrError("Failed to connect to prowlarr.test: ECONNREFUSED")).toBe(
      "Prowlarr unreachable: Connection refused"
    )
    expect(sanitizeProwlarrError("Request to prowlarr.test timed out")).toBe(
      "Prowlarr unreachable: Request timed out"
    )
    expect(sanitizeProwlarrError("Prowlarr API error: 403")).not.toMatch(/unreachable/)
  })
})

describe("transport", () => {
  it("sends the key as a header, does not follow redirects and sets no User-Agent", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ version: "1.2.3" }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(fetchSystemStatus(CONN)).resolves.toEqual({ version: "1.2.3" })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("http://prowlarr.test:9696/api/v1/system/status")
    expect(init.redirect).toBe("manual")
    expect(init.signal).toBeInstanceOf(AbortSignal)
    const headers = init.headers as Record<string, string>
    expect(headers["X-Api-Key"]).toBe(CONN.apiKey)
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain("user-agent")
    expect(url).not.toContain(CONN.apiKey)
  })

  it("keeps a URL base and only ever makes GET requests", async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]))
    vi.stubGlobal("fetch", fetchMock)

    await fetchIndexerStatuses({ ...CONN, url: "http://host.test/prowlarr/" })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("http://host.test/prowlarr/api/v1/indexerstatus")
    expect(init.method ?? "GET").toBe("GET")
    expect(init.body).toBeUndefined()
  })

  it("turns an HTTP error into a status the sanitizer understands", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unauthorized", { status: 401 }))
    )
    await expect(fetchIndexers(CONN)).rejects.toThrow("Prowlarr API error: 401")
  })

  it("rejects a body that is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>login</html>", { status: 200 }))
    )
    await expect(fetchIndexers(CONN)).rejects.toThrow(/not JSON/)
  })

  it("names the host, never the URL or key, when the connection fails", async () => {
    const refused = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw refused
      })
    )
    const err = await fetchIndexers(CONN).catch((e: Error) => e)
    expect((err as Error).message).toBe("Failed to connect to prowlarr.test: ECONNREFUSED")
  })
})
