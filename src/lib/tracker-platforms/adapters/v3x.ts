// src/lib/tracker-platforms/adapters/v3x.ts
//
// Functions: parseV3xCredentials, numeric, parseV3xMe, fetchJson, fetchMe, rankLabel,
//            unreadCount, fetchInbox, seedsTotal, parseWarned, parseV3xProfile, optional,
//            V3xAdapter

import { computeBufferBytes, computeRatio } from "@/lib/data-transforms"
import { log } from "@/lib/logger"
import { validateCookieHeader } from "@/lib/tracker-credentials/cookie-header"
import type {
  DebugApiCall,
  FetchOptions,
  TrackerAdapter,
  TrackerInbox,
  TrackerStats,
  V3xPlatformMeta,
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
// perPage=1 because only the total is read
const SEEDING_PATH = "/me/seeds?kind=seeding&perPage=1"
const LEECHING_PATH = "/me/seeds?kind=leeching&perPage=1"
const WARNINGS_PATH = "/me/warnings"
const profilePath = (username: string) => `/users/${encodeURIComponent(username)}`
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
  downloadedReal?: number
  bonusPoints?: number
  freeleechTokens?: number
  createdAt?: string
  ratioFloor?: { floor?: number }
  hnr?: { active?: number }
}

interface V3xProfile {
  id?: number
  lastLoginAt?: string
  lastVisitDay?: string
  invitesLeft?: number
  uploadBonusBytes?: number
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
  const downloadedReal = numeric(body.downloadedReal)

  const stats: TrackerStats = {
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
  // The site shows the real download only when it is above the counted one
  if (downloadedReal !== null) {
    const meta: V3xPlatformMeta = {
      freeleechDownloadedBytes: Math.max(0, downloadedReal - Number(downloadedBytes)),
    }
    stats.platformMeta = meta
  }
  return stats
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

function seedsTotal(body: unknown, path: string): number {
  const value = (body as { total?: unknown } | null)?.total
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Unexpected response from ${API_HOST}: missing total in ${path}`)
  }
  return value
}

/** Active warnings only: the site drops a warning after six months. */
function parseWarned(body: unknown): boolean {
  const warnings = (body as { warnings?: unknown } | null)?.warnings
  if (!Array.isArray(warnings)) {
    throw new Error(`Unexpected response from ${API_HOST}: missing warnings in ${WARNINGS_PATH}`)
  }
  return warnings.length > 0
}

export function parseV3xProfile(profile: V3xProfile | null) {
  if (profile == null || typeof profile !== "object") {
    throw new Error(`Unexpected response from ${API_HOST}: missing profile object`)
  }
  const meta: V3xPlatformMeta = {}
  const invites = numeric(profile.invitesLeft)
  if (invites !== null) meta.invites = invites
  const bonus = numeric(profile.uploadBonusBytes)
  if (bonus !== null) meta.bonusUploadedBytes = bonus
  return {
    remoteUserId:
      typeof profile.id === "number" && Number.isInteger(profile.id) && profile.id > 0
        ? profile.id
        : undefined,
    // The site shows the last visit day, and the last login only without one
    lastAccessDate: [profile.lastVisitDay, profile.lastLoginAt].find(
      (value): value is string => typeof value === "string" && value !== ""
    ),
    meta,
  }
}

/** A read the poll can do without: a 401 still fails the poll, anything else is logged. */
async function optional<T>(what: string, read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read()
  } catch (err) {
    if (err instanceof SessionExpiredError) throw err
    log.warn({ err }, `v3x: ${what} failed`)
    return undefined
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
    const read =
      <T>(path: string, parse: (body: unknown) => T) =>
      async () =>
        parse(await fetchJson<unknown>(path, creds, options))

    // A failed read leaves its fields unknown: the class empty, the counts null,
    // the inbox as last read.
    const [group, inbox, seeding, leeching, warned, profile] = await Promise.all([
      // The class is the rank label alone. Falling back to the role would raise
      // a rank change each time this call fails or recovers.
      optional(
        "gamification",
        read(GAMIFICATION_PATH, (b) => rankLabel(b as V3xGamification))
      ),
      optional("unread counts", () => fetchInbox(baseUrl, creds, options)),
      optional(
        "seeding count",
        read(SEEDING_PATH, (b) => seedsTotal(b, SEEDING_PATH))
      ),
      optional(
        "leeching count",
        read(LEECHING_PATH, (b) => seedsTotal(b, LEECHING_PATH))
      ),
      optional("warnings", read(WARNINGS_PATH, parseWarned)),
      stats.username
        ? optional(
            "profile",
            read(profilePath(stats.username), (b) => parseV3xProfile(b as V3xProfile))
          )
        : undefined,
    ])
    stats.group = group ?? null
    stats.inbox = inbox
    stats.seedingCount = seeding ?? null
    stats.leechingCount = leeching ?? null
    stats.warned = warned ?? null
    if (profile) {
      stats.remoteUserId = profile.remoteUserId
      stats.lastAccessDate = profile.lastAccessDate
      const meta: V3xPlatformMeta = { ...stats.platformMeta, ...profile.meta }
      if (Object.keys(meta).length > 0) stats.platformMeta = meta
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

    const get = (label: string, path: string, check?: (data: unknown) => void) =>
      call(label, path, () => fetchJson<unknown>(path, creds, options), check)

    // A body fetchStats would fail or skip must not read as healthy here
    // (adapter standard 2.6).
    const me = await get("Me", ME_PATH, (data) => parseV3xMe(data as V3xMe))
    const username = (me.data as V3xMe | null)?.username
    const calls = [
      me,
      await get("Gamification", GAMIFICATION_PATH),
      await get("Notifications", NOTIFICATIONS_PATH, (d) =>
        unreadCount(d, "unread", NOTIFICATIONS_PATH)
      ),
      await get("Messages", MESSAGES_PATH, (d) => unreadCount(d, "count", MESSAGES_PATH)),
      await get("Conversations", CONVERSATIONS_PATH, (d) =>
        unreadCount(d, "count", CONVERSATIONS_PATH)
      ),
      await get("Seeding", SEEDING_PATH, (d) => seedsTotal(d, SEEDING_PATH)),
      await get("Leeching", LEECHING_PATH, (d) => seedsTotal(d, LEECHING_PATH)),
      await get("Warnings", WARNINGS_PATH, parseWarned),
    ]
    if (typeof username === "string" && username) {
      calls.push(
        await get("Profile", profilePath(username), (d) => parseV3xProfile(d as V3xProfile))
      )
    }
    return calls
  }
}
