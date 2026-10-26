// src/lib/tracker-platforms/adapters/v3x.ts
//
// Functions: parseV3xCredentials, numeric, parseV3xMe, fetchJson, fetchMe, fetchGamification,
//            rankLabel, unreadCount, fetchInbox, V3xAdapter

import { computeBufferBytes, computeRatio } from "@/lib/data-transforms"
import { log } from "@/lib/logger"
import { validateCookieHeader } from "@/lib/tracker-credentials/cookie-header"
import type {
  DebugApiCall,
  FetchOptions,
  TrackerAdapter,
  TrackerInbox,
  TrackerStats,
} from "../contract"
import { adapterRequest } from "../helpers/adapter-fetch"
import { requireBytes } from "../helpers/bytes"
import { presentClass } from "../helpers/class-name"
import { parseCredentialJson } from "../helpers/cookie-credentials"
import { SessionExpiredError } from "../helpers/errors"
import { pollError } from "../helpers/poll-error"

// V3X serves its JSON API from a fixed host, and the web app calls it with
// `credentials: "include"`, so cookie auth is the protocol here.
const API_HOST = "api.v3x.club"
const API_BASE = `https://${API_HOST}`
const ME_PATH = "/auth/me"
const GAMIFICATION_PATH = "/me/gamification"
const NOTIFICATIONS_PATH = "/notifications/unread-count"
// Direct messages and group conversations, which the site's message badge adds up
const MESSAGES_PATH = "/messages/unread"
const CONVERSATIONS_PATH = "/conversations/unread"
const LABEL = "V3X"
const SESSION_EXPIRED = "Session expired. Browser cookies need to be refreshed"

export interface V3xCredentials {
  cookies: string
  userAgent: string
}

export function parseV3xCredentials(apiToken: string): V3xCredentials {
  const { cookies, userAgent } = parseCredentialJson(apiToken, LABEL, [
    "cookies",
    "userAgent",
  ] as const)

  return {
    cookies: validateCookieHeader(cookies, {
      extraCookieNames: ["v3x_session", "__Host-v3x_session", "session"],
      example: "v3x_session=...",
    }),
    userAgent,
  }
}

interface V3xMe {
  username?: string
  uploaded?: number
  downloaded?: number
  bonusPoints?: number
  freeleechTokens?: number
  createdAt?: string
  ratioFloor?: { floor?: number }
  hnr?: { active?: number }
}

interface V3xGamification {
  rank?: { label?: string }
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** The poll without its class, which comes from the gamification call. */
export function parseV3xMe(body: V3xMe | null): TrackerStats {
  if (body == null || typeof body !== "object") {
    throw new Error(`Unexpected response from ${API_HOST}: missing user object`)
  }
  const uploadedBytes = requireBytes(body.uploaded, "uploaded", API_HOST)
  const downloadedBytes = requireBytes(body.downloaded, "downloaded", API_HOST)

  return {
    username: typeof body.username === "string" ? body.username : "",
    group: null,
    uploadedBytes,
    downloadedBytes,
    ratio: computeRatio(uploadedBytes, downloadedBytes),
    bufferBytes: computeBufferBytes(uploadedBytes, downloadedBytes),
    seedingCount: null,
    leechingCount: null,
    seedbonus: numeric(body.bonusPoints),
    hitAndRuns: numeric(body.hnr?.active),
    requiredRatio: numeric(body.ratioFloor?.floor),
    warned: null,
    freeleechTokens: numeric(body.freeleechTokens),
    joinedDate: typeof body.createdAt === "string" ? body.createdAt : undefined,
  }
}

/**
 * Only a 401 means the cookies expired. Cloudflare also answers 403, so a 403
 * fails as an ordinary error rather than asking for new cookies.
 */
async function fetchJson<T>(path: string, creds: V3xCredentials, options?: FetchOptions) {
  const response = await adapterRequest(`${API_BASE}${path}`, API_HOST, options, {
    Cookie: creds.cookies,
    "User-Agent": creds.userAgent,
  })
  if (response.status === 401) throw new SessionExpiredError(SESSION_EXPIRED)
  if (!response.ok) {
    throw new Error(`Tracker API error: ${response.status} ${response.statusText}`)
  }
  return response.json<T>()
}

const fetchMe = (creds: V3xCredentials, options?: FetchOptions) =>
  fetchJson<V3xMe | null>(ME_PATH, creds, options)

const fetchGamification = (creds: V3xCredentials, options?: FetchOptions) =>
  fetchJson<V3xGamification | null>(GAMIFICATION_PATH, creds, options)

function rankLabel(game: V3xGamification | null): string | null {
  const label = presentClass(game?.rank?.label)
  return label === null ? null : label.trim()
}

function unreadCount(body: unknown, field: "unread" | "count", path: string): number {
  const value = (body as Record<string, unknown> | null)?.[field]
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Unexpected response from ${API_HOST}: missing ${field} in ${path}`)
  }
  return value
}

async function fetchInbox(
  baseUrl: string,
  creds: V3xCredentials,
  options?: FetchOptions
): Promise<TrackerInbox> {
  const [notifications, messages, conversations] = await Promise.all(
    [NOTIFICATIONS_PATH, MESSAGES_PATH, CONVERSATIONS_PATH].map((path) =>
      fetchJson<unknown>(path, creds, options)
    )
  )
  return {
    unreadMessages:
      unreadCount(messages, "count", MESSAGES_PATH) +
      unreadCount(conversations, "count", CONVERSATIONS_PATH),
    unreadStaffMessages: null,
    unreadNotifications: unreadCount(notifications, "unread", NOTIFICATIONS_PATH),
    links: { inbox: new URL("/messages", baseUrl).toString() },
  }
}

export class V3xAdapter implements TrackerAdapter {
  // _apiPath is ignored: /auth/me is intrinsic to the platform, not a property
  // of a user's row, so a stale persisted api_path value self-heals instead of
  // breaking the adapter (the filelist.ts precedent).
  async fetchStats(
    baseUrl: string,
    apiToken: string,
    _apiPath: string,
    options?: FetchOptions
  ): Promise<TrackerStats> {
    const creds = parseV3xCredentials(apiToken)
    const stats = parseV3xMe(await fetchMe(creds, options))

    // The class is the rank label alone. Falling back to the role would raise a
    // rank change each time this call fails or recovers.
    try {
      stats.group = rankLabel(await fetchGamification(creds, options))
    } catch (err) {
      if (err instanceof SessionExpiredError) throw err
      log.warn({ err }, "v3x: gamification failed, class left empty")
    }

    try {
      stats.inbox = await fetchInbox(baseUrl, creds, options)
    } catch (err) {
      if (err instanceof SessionExpiredError) throw err
      log.warn({ err }, "v3x: unread counts failed, inbox left as last read")
    }
    return stats
  }

  async fetchRaw(
    _baseUrl: string,
    apiToken: string,
    _apiPath: string,
    options?: FetchOptions
  ): Promise<DebugApiCall[]> {
    const creds = parseV3xCredentials(apiToken)
    const call = async (
      label: string,
      endpoint: string,
      read: () => Promise<unknown>,
      check?: (data: unknown) => void
    ): Promise<DebugApiCall> => {
      try {
        const data = await read()
        return { label, endpoint, data, error: check ? pollError(() => check(data)) : null }
      } catch (err) {
        return {
          label,
          endpoint,
          data: null,
          error: err instanceof Error ? err.message : "Request failed",
        }
      }
    }

    return [
      // A body fetchStats would fail must not read as healthy here (adapter
      // standard 2.6).
      await call(
        "Me",
        ME_PATH,
        () => fetchMe(creds, options),
        (data) => parseV3xMe(data as V3xMe)
      ),
      await call("Gamification", GAMIFICATION_PATH, () => fetchGamification(creds, options)),
      await call(
        "Notifications",
        NOTIFICATIONS_PATH,
        () => fetchJson<unknown>(NOTIFICATIONS_PATH, creds, options),
        (data) => unreadCount(data, "unread", NOTIFICATIONS_PATH)
      ),
      await call(
        "Messages",
        MESSAGES_PATH,
        () => fetchJson<unknown>(MESSAGES_PATH, creds, options),
        (data) => unreadCount(data, "count", MESSAGES_PATH)
      ),
      await call(
        "Conversations",
        CONVERSATIONS_PATH,
        () => fetchJson<unknown>(CONVERSATIONS_PATH, creds, options),
        (data) => unreadCount(data, "count", CONVERSATIONS_PATH)
      ),
    ]
  }
}
