// src/lib/mousehole.ts
//
// Functions: parseMouseholeUrl, stripUrlCredentials, mouseholeStatus
//
// The API token rides in the URL's userinfo (http://:<token>@host:port); fetch()
// rejects credentialed URLs, so it is split out and sent as a Bearer header.

export type MouseholeResult =
  "ok" | "throttled" | "no-cookie" | "pending" | "rejected" | "unreachable"

export interface MouseholeStatusResponse {
  result: MouseholeResult | null
  hasCookie: boolean | null
  ip: string | null
  asn: number | null
  asOrg: string | null
  nextContactAt: string | null
  lastContactAt: string | null
  lastMessage: string | null
  stateError: string | null
}

export interface ParsedMouseholeUrl {
  baseUrl: string
  token: string | null
}

export function parseMouseholeUrl(raw: string): ParsedMouseholeUrl {
  const url = new URL(raw)
  const credential = url.password || url.username
  const token = credential ? decodeURIComponent(credential) : null
  return { baseUrl: stripUrlCredentials(raw), token }
}

export function stripUrlCredentials(raw: string): string {
  try {
    const url = new URL(raw)
    url.username = ""
    url.password = ""
    return url.toString().replace(/\/+$/, "")
  } catch {
    return ""
  }
}

export function mouseholeStatus(result: string | null): {
  label: string
  tone: "success" | "warn" | "danger"
} {
  switch (result) {
    case "ok":
      return { label: "OK", tone: "success" }
    case "throttled":
      return { label: "Throttled", tone: "warn" }
    case "no-cookie":
      return { label: "No cookie", tone: "warn" }
    case "pending":
      return { label: "Pending", tone: "warn" }
    case "rejected":
      return { label: "Rejected", tone: "danger" }
    case "unreachable":
      return { label: "Unreachable", tone: "danger" }
    default:
      return { label: "Down", tone: "danger" }
  }
}
