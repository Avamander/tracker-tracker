// src/lib/tracker-platforms/adapters/c411.ts
//
// Functions: c411GradeName, c411ClassName, transferTotals, absoluteUrl, fetchProfile,
//            C411Adapter

import { computeBufferBytes, computeRatio } from "@/lib/data-transforms"
import { validateHeaderToken } from "@/lib/tracker-credentials/header-token"
import type { DebugApiCall, FetchOptions, TrackerAdapter, TrackerStats } from "../contract"
import { adapterRequest } from "../helpers/adapter-fetch"
import { requireBytes } from "../helpers/bytes"
import { presentClass } from "../helpers/class-name"
import { pollError } from "../helpers/poll-error"

// C411's profile endpoint, read with an API key that has the "Profil (lecture)"
// scope, sent as a bearer token.

interface C411Transfer {
  actual?: number | null
  credit?: number | null
  total?: number | null
}

interface C411ProfileResponse {
  id: number
  username?: string
  avatarUrl?: string | null
  memberSince?: string
  class?: {
    slug?: string
    effectiveSlug?: string
    progress?: { grade?: { tier?: string; level?: number } | null } | null
  } | null
  zen?: { balance?: number | null } | null
  transfer?: { uploaded?: C411Transfer; downloaded?: C411Transfer } | null
}

const GRADE_TIERS: Record<string, string> = { bronze: "Bronze", argent: "Argent", or: "Or" }
const GRADE_LEVELS = ["I", "II", "III", "IV"]

/**
 * A grade as the site names it, from Bronze I to Or 411. Or has three numbered
 * levels and then Or 411, which is taken to be its fourth.
 */
function c411GradeName(grade: { tier?: string; level?: number } | null | undefined): string | null {
  const tier = typeof grade?.tier === "string" ? GRADE_TIERS[grade.tier.toLowerCase()] : undefined
  const level = grade?.level
  if (!tier || typeof level !== "number" || !GRADE_LEVELS[level - 1]) return null
  if (tier === "Or" && level === 4) return "Or 411"
  return `${tier} ${GRADE_LEVELS[level - 1]}`
}

// The site's names for each class slug. A team class variant such as
// team_resident_mainstream is reported by its base slug; a slug missing here
// shows as sent.
const CLASS_NAMES: Record<string, string> = {
  tanker: "Tanker",
  swarm_keeper: "Swarm Keeper",
  swarm_reaper: "Swarm Reaper",
  reuploader: "Reuploader",
  team_mainstream: "Team Mainstream",
  team_niche: "Team Niche",
}

function c411ClassName(slug: unknown): string | null {
  const id = typeof slug === "string" ? slug.trim() : ""
  if (id === "") return null
  return Object.hasOwn(CLASS_NAMES, id) ? CLASS_NAMES[id] : id
}

/**
 * Upload and download as C411 counts them: the transferred bytes adjusted by
 * the account's credit, which the site's ratio is computed from.
 */
function transferTotals(
  data: C411ProfileResponse,
  hostname: string
): { uploadedBytes: bigint; downloadedBytes: bigint } {
  return {
    uploadedBytes: requireBytes(data.transfer?.uploaded?.total, "uploaded total", hostname),
    downloadedBytes: requireBytes(data.transfer?.downloaded?.total, "downloaded total", hostname),
  }
}

/** The avatar path C411 sends is relative to the site. */
function absoluteUrl(path: string | null | undefined, baseUrl: string): string | undefined {
  if (!path) return undefined
  try {
    return new URL(path, baseUrl).toString()
  } catch {
    return undefined
  }
}

/**
 * The profile, or an error carrying C411's own reason, such as a site-wide
 * restriction that refuses API keys too.
 */
async function fetchProfile(
  baseUrl: string,
  apiPath: string,
  token: string,
  options?: FetchOptions
): Promise<C411ProfileResponse> {
  const hostname = new URL(baseUrl).hostname
  const res = await adapterRequest(new URL(apiPath, baseUrl).toString(), hostname, options, {
    Authorization: `Bearer ${token}`,
  })
  if (!res.ok) {
    let reason = ""
    try {
      const body = JSON.parse(await res.text()) as { message?: unknown }
      if (typeof body.message === "string") reason = `: ${body.message.slice(0, 200)}`
    } catch {}
    throw new Error(`Tracker API error: ${res.status} ${res.statusText}${reason}`)
  }
  return res.json<C411ProfileResponse>()
}

export class C411Adapter implements TrackerAdapter {
  async fetchStats(
    baseUrl: string,
    apiToken: string,
    apiPath: string,
    options?: FetchOptions
  ): Promise<TrackerStats> {
    const token = validateHeaderToken(apiToken)
    const hostname = new URL(baseUrl).hostname
    const data = await fetchProfile(baseUrl, apiPath, token, options)

    const { uploadedBytes, downloadedBytes } = transferTotals(data, hostname)

    return {
      username: data.username ?? "",
      group:
        c411GradeName(data.class?.progress?.grade) ??
        c411ClassName(data.class?.slug) ??
        presentClass(data.class?.effectiveSlug),
      uploadedBytes,
      downloadedBytes,
      ratio: computeRatio(uploadedBytes, downloadedBytes),
      bufferBytes: computeBufferBytes(uploadedBytes, downloadedBytes),
      seedingCount: null,
      leechingCount: null,
      seedbonus: typeof data.zen?.balance === "number" ? data.zen.balance : null,
      hitAndRuns: null,
      requiredRatio: null,
      warned: null,
      freeleechTokens: null,
      remoteUserId: data.id,
      joinedDate: data.memberSince,
      avatarUrl: absoluteUrl(data.avatarUrl, baseUrl),
    }
  }

  async fetchRaw(
    baseUrl: string,
    apiToken: string,
    apiPath: string,
    options?: FetchOptions
  ): Promise<DebugApiCall[]> {
    const token = validateHeaderToken(apiToken)
    const hostname = new URL(baseUrl).hostname

    try {
      const data = await fetchProfile(baseUrl, apiPath, token, options)
      // A body fetchStats would fail must not read as healthy here (adapter
      // standard 2.6).
      return [
        {
          label: "Profile",
          endpoint: apiPath,
          data,
          error: pollError(() => transferTotals(data, hostname)),
        },
      ]
    } catch (err) {
      return [
        {
          label: "Profile",
          endpoint: apiPath,
          data: null,
          error: err instanceof Error ? err.message : "Request failed",
        },
      ]
    }
  }
}
