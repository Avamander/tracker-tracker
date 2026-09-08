// src/lib/adapters/avistaz.ts
//
// Functions: parseAvistazCredentials, strictParseBytes, textAfterLabel, textFromDatagrid,
//            extractRatioBarValue, parseAvistazProfile, fetchHtml, AvistazAdapter

import { type HTMLElement as ParsedElement, parse as parseHtml } from "node-html-parser"
import { computeBufferBytes, computeRatio } from "@/lib/data-transforms"
import { localDateStr } from "@/lib/formatters"
import { parseBytes } from "@/lib/parser"
import { parseCredentialJson, validateCookieHeader } from "./cookie-credentials"
import { SessionExpiredError } from "./errors"
import { fetchTrackerHtml } from "./html-fetch"
import type {
  AvistazPlatformMeta,
  DebugApiCall,
  FetchOptions,
  TrackerAdapter,
  TrackerStats,
} from "./types"

// ---------------------------------------------------------------------------
// Credential handling
// ---------------------------------------------------------------------------

export interface AvistazCredentials {
  cookies: string
  userAgent: string
  username: string
}

export function parseAvistazCredentials(apiToken: string): AvistazCredentials {
  const { cookies, userAgent, username } = parseCredentialJson(apiToken, "AvistaZ", [
    "cookies",
    "userAgent",
    "username",
  ] as const)

  return {
    cookies: validateCookieHeader(cookies, {
      extraCookieNames: ["love"],
      example: "cf_clearance=abc123; session=xyz",
    }),
    userAgent,
    username,
  }
}

// ---------------------------------------------------------------------------
// Byte parsing: parseBytes handles both binary (GiB) and decimal (GB) units
// with exact bigint arithmetic. AvistaZ uses decimal units (GB, KB).
// ---------------------------------------------------------------------------

function strictParseBytes(text: string, field: string): bigint {
  const trimmed = text.trim()
  if (!trimmed) throw new Error(`AvistaZ: empty ${field} byte string`)
  return parseBytes(trimmed)
}

// ---------------------------------------------------------------------------
// HTML parsing helpers
// ---------------------------------------------------------------------------

function textAfterLabel(rows: ParsedElement[], label: string): string {
  for (const row of rows) {
    const cells = row.querySelectorAll("td")
    if (cells.length >= 2 && cells[0].textContent?.includes(label)) {
      return cells[1].textContent?.trim() ?? ""
    }
  }
  return ""
}

// BS5 (AnimeZ) uses datagrid divs instead of tables
function textFromDatagrid(doc: ParsedElement, label: string): string {
  const items = doc.querySelectorAll(".datagrid-item")
  for (const item of items) {
    const title = item.querySelector(".datagrid-title")?.textContent?.trim()
    if (title === label) {
      return item.querySelector(".datagrid-content")?.textContent?.trim() ?? ""
    }
  }
  return ""
}

/**
 * Extracts the numeric value after a labeled entry in ratio bar items.
 * Uses regex-only matching to handle whitespace variations in the DOM
 * (i.e. "Hit & Run:" may have line breaks between words).
 */
/**
 * A ratio-bar figure as a number, or null when the bar carries no such item.
 * extractRatioBarValue returns "" for an absent label and parseInt("") is NaN,
 * which the old `|| 0` turned into a measured zero.
 */
function ratioBarNumber(items: ParsedElement[], labelRegex: RegExp): number | null {
  const raw = extractRatioBarValue(items, labelRegex)
  if (!raw) return null
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : null
}

/** A count from an item's own text, or null when it holds no number. */
function toCount(text: string): number | null {
  const value = Number.parseInt(text.replace(/,/g, ""), 10)
  return Number.isFinite(value) ? value : null
}

function extractRatioBarValue(items: ParsedElement[], labelRegex: RegExp): string {
  for (const li of items) {
    const text = li.textContent?.replace(/\s+/g, " ").trim() ?? ""
    const match = text.match(labelRegex)
    if (match?.[1]) return match[1].replace(/,/g, "")
  }
  return ""
}

// ---------------------------------------------------------------------------
// Profile page parser
// ---------------------------------------------------------------------------

export function parseAvistazProfile(html: string, username: string): TrackerStats {
  // Detect login redirect. AvistaZ uses /auth/login, AnimeZ and others use /login.
  if (html.includes("/auth/login") || html.includes('action="/login"')) {
    throw new SessionExpiredError("Session expired. Browser cookies need to be refreshed")
  }

  // Detect Cloudflare challenge (classic JS challenge or Turnstile widget)
  if (
    html.includes("<title>Just a moment...</title>") ||
    html.includes("cf_chl_opt") ||
    html.includes("challenges.cloudflare.com/turnstile")
  ) {
    throw new Error("Cloudflare challenge detected. The cf_clearance cookie needs refreshing")
  }

  const doc = parseHtml(html)

  // ── Ratio bar ──────────────────────────────────────────────────────────────
  const ratioBar = doc.querySelector("div.ratio-bar")
  if (!ratioBar) {
    throw new Error("Could not find ratio bar in profile page. The page may not be authenticated")
  }

  const items = Array.from(ratioBar.querySelectorAll("ul.list-inline > li"))

  // Username: BS3 uses span.badge-user in the ratio bar, BS5 omits it.
  // Fall back to the username passed from credentials.
  const parsedUsername = ratioBar.querySelector("span.badge-user")?.textContent?.trim() ?? username

  // Group: BS3 has two badge-user spans (username, group) in the ratio bar.
  // BS5 puts the group in a separate badge element elsewhere on the page.
  const groupSpans = ratioBar.querySelectorAll("span.badge-user")
  let group = "Unknown"
  if (groupSpans.length >= 2) {
    group = groupSpans[1].textContent?.trim() ?? "Unknown"
  } else {
    const badgeEl = doc.querySelector(".badge.bg-secondary-lt, .badge-extra.badge-sm")
    if (badgeEl) group = badgeEl.textContent?.trim() ?? "Unknown"
  }

  // Upload / download / seeding / leeching / bonus from tooltip-titled items
  // undefined until a row is actually read, so "the ratio bar had no Upload
  // item" stays distinct from "it said 0 B". Only the first is a parse failure.
  let uploadedBytes: bigint | undefined
  let downloadedBytes: bigint | undefined
  // null until the ratio bar actually yields the figure. types.ts requires an
  // unknown count to stay distinguishable from a measured zero, and a zero
  // start reported "no seeds" for a bar that simply had no Active Seeds item.
  let seedingCount: number | null = null
  let leechingCount: number | null = null
  let seedbonus: number | null = null

  for (const li of items) {
    // AvistaZ (BS3): data-toggle="tooltip" title="Upload"
    // AnimeZ (BS5): data-bs-toggle="tooltip" title="Uploaded"
    const isTooltip =
      li.getAttribute("data-toggle") === "tooltip" ||
      li.getAttribute("data-bs-toggle") === "tooltip"
    const title = isTooltip ? (li.getAttribute("title")?.trim() ?? null) : null
    // Strip everything except digits, decimal point, and unit letters/spaces
    const text = li.textContent?.replace(/[^\d.a-zA-Z\s]/g, "").trim() ?? ""

    if (title === "Upload" || title === "Uploaded") {
      uploadedBytes = strictParseBytes(text, "upload")
    } else if (title === "Download" || title === "Downloaded") {
      downloadedBytes = strictParseBytes(text, "download")
    } else if (title === "Active Seeds") {
      seedingCount = toCount(text)
    } else if (title === "Active Leeches") {
      leechingCount = toCount(text)
    } else if (title === "Bonus Points") {
      const numMatch = text.match(/([\d,.]+)/)
      seedbonus = numMatch ? Number.parseFloat(numMatch[1].replace(/,/g, "")) : null
    }
  }

  // A ratio bar with neither item is a page this parser does not understand.
  // A brand new account, whose items read 0 B, is not, and used to throw here.
  if (uploadedBytes === undefined && downloadedBytes === undefined) {
    throw new Error(
      "Could not extract upload/download bytes from AvistaZ ratio bar. The page structure may have changed."
    )
  }

  const uploaded = uploadedBytes ?? 0n
  const downloaded = downloadedBytes ?? 0n

  // BS3 (AvistaZ) uses text labels like "Seeding: 2". BS5 (AnimeZ) uses tooltip
  // titles handled above. Fall back to text-based extraction for BS3. A tooltip
  // that read a real zero is now kept rather than sent back through the
  // fallback, which the old falsy test could not tell from "nothing found".
  if (seedingCount === null) seedingCount = ratioBarNumber(items, /Seeding:\s*([\d,]+)/)
  if (leechingCount === null) leechingCount = ratioBarNumber(items, /Leeching:\s*([\d,]+)/)
  if (seedbonus === null) seedbonus = ratioBarNumber(items, /Bonus:\s*([\d,.]+)/)
  const hitAndRuns = ratioBarNumber(items, /Hit\s*&\s*Run:\s*([\d,]+)/)
  const reseedRequests = parseInt(extractRatioBarValue(items, /Reseed:\s*([\d,]+)/), 10) || 0

  // ── Profile table rows ─────────────────────────────────────────────────────
  const allRows = Array.from(
    doc.querySelectorAll("table.table-striped tr, table.table-bordered tr")
  )

  // BS3 uses table rows, BS5 uses datagrid divs. Try both, preferring table.
  const field = (label: string, ...altLabels: string[]) => {
    const fromTable = textAfterLabel(allRows, label)
    if (fromTable) return fromTable
    for (const alt of altLabels) {
      const fromGrid = textFromDatagrid(doc, alt)
      if (fromGrid) return fromGrid
    }
    return textFromDatagrid(doc, label)
  }

  const userIdText = field("User ID")
  const userIdMatch = userIdText.match(/(\d+)/)
  const remoteUserId = userIdMatch ? parseInt(userIdMatch[1], 10) : undefined

  const joinedRaw = field("Joined", "Member Since")
    .replace(/\s*\(.*\)/, "")
    .trim()
  const joinedDate = joinedRaw ? localDateStr(new Date(joinedRaw)) : undefined

  const lastAccessRaw = field("Last Access", "Last Seen")
    .replace(/\s*\(.*\)/, "")
    .trim()
  const lastAccessDate = lastAccessRaw ? localDateStr(new Date(lastAccessRaw)) : undefined

  // ── Private account-detail rows ────────────────────────────────────────────
  const donorText = field("Donor")
  const vipExpiryText = field("VIP Expiry")
  const invitesText = field("Invites")
  const canDownloadText = field("Can Download")
  const canUploadText = field("Can Upload")
  const twoFaText = field("2FA")

  // ── Avatar ─────────────────────────────────────────────────────────────────
  // On your own profile, the avatar <img> is JS-rendered by the Fine Uploader
  // widget (static HTML parsing misses it). The URL
  // does appear in the raw HTML though, so we scan for the /images/avatar/ pattern.
  let avatarUrl: string | undefined

  const avatarSelectors = ["#avatar-uploader img", ".avatar-cell img", "img.avatar-original"]
  for (const sel of avatarSelectors) {
    const img = doc.querySelector(sel)
    const src = img?.getAttribute("src")?.trim()
    if (src) {
      avatarUrl = src.replace(/&amp;/g, "&")
      break
    }
  }

  if (!avatarUrl) {
    // Fallback: scan raw HTML for avatar image URLs (catches JS-rendered content)
    const htmlAvatarMatch = html.match(
      /https?:\/\/[^"'\s<>]+\/images\/avatar\/[^"'\s<>]+\.(?:jpg|png|gif|webp)/i
    )
    if (htmlAvatarMatch) {
      avatarUrl = htmlAvatarMatch[0].replace(/&amp;/g, "&")
    }
  }

  // ── Activity summary (.well-sm block) ──────────────────────────────────────
  const wellItems = Array.from(doc.querySelectorAll(".well-sm li"))
  let totalUploads = 0
  let totalDownloads = 0

  for (const li of wellItems) {
    const text = li.textContent?.trim() ?? ""
    const strong = li.querySelector("strong")?.textContent?.trim() ?? "0"
    if (text.includes("Total Uploads")) {
      totalUploads = parseInt(strong, 10) || 0
    } else if (text.includes("Downloads")) {
      totalDownloads = parseInt(strong, 10) || 0
    }
  }

  const platformMeta: AvistazPlatformMeta = {
    donor: donorText.toLowerCase().includes("yes") || donorText.toLowerCase().includes("true"),
    vipExpiry: vipExpiryText === "-" ? null : vipExpiryText || null,
    invites: parseInt(invitesText, 10) || 0,
    canDownload: canDownloadText.toLowerCase() !== "no",
    canUpload: canUploadText.toLowerCase() !== "no",
    totalUploads,
    totalDownloads,
    reseedRequests,
    twoFactorEnabled: !twoFaText.includes("Not Enabled"),
  }

  return {
    username: parsedUsername,
    group,
    uploadedBytes: uploaded,
    downloadedBytes: downloaded,
    // Compute from byte totals, not the ratio bar. AvistaZ caps its display at
    // 999999.99, so a near-zero account parses to a fake number not infinity.
    ratio: computeRatio(uploaded, downloaded),
    bufferBytes: computeBufferBytes(uploaded, downloaded),
    seedingCount,
    leechingCount,
    seedbonus,
    hitAndRuns,
    requiredRatio: null,
    warned: null,
    freeleechTokens: null,
    remoteUserId,
    joinedDate,
    lastAccessDate,
    avatarUrl,
    platformMeta,
  }
}

// ---------------------------------------------------------------------------
// HTML fetcher, direct fetch or proxy
// ---------------------------------------------------------------------------

function fetchHtml(
  url: string,
  cookies: string,
  userAgent: string,
  proxyAgent?: FetchOptions["proxyAgent"]
): Promise<string> {
  // A 302 here means the session expired and the server bounced us to login.
  return fetchTrackerHtml({
    url,
    cookies,
    userAgent,
    proxyAgent,
    label: "AvistaZ",
    sessionExpiredMessage: "Session expired. Browser cookies need to be refreshed",
  })
}

// ---------------------------------------------------------------------------
// Adapter class
// ---------------------------------------------------------------------------

export class AvistazAdapter implements TrackerAdapter {
  async fetchStats(
    baseUrl: string,
    apiToken: string,
    _apiPath: string,
    options?: FetchOptions
  ): Promise<TrackerStats> {
    const creds = parseAvistazCredentials(apiToken)
    const profileUrl = `${baseUrl}/profile/${encodeURIComponent(creds.username)}`
    const html = await fetchHtml(profileUrl, creds.cookies, creds.userAgent, options?.proxyAgent)
    return parseAvistazProfile(html, creds.username)
  }

  async fetchRaw(
    baseUrl: string,
    apiToken: string,
    _apiPath: string,
    options?: FetchOptions
  ): Promise<DebugApiCall[]> {
    const calls: DebugApiCall[] = []
    const creds = parseAvistazCredentials(apiToken)
    const profileUrl = `${baseUrl}/profile/${encodeURIComponent(creds.username)}`
    const endpoint = `/profile/${creds.username}`

    try {
      const html = await fetchHtml(profileUrl, creds.cookies, creds.userAgent, options?.proxyAgent)
      const stats = parseAvistazProfile(html, creds.username)
      calls.push({ label: "Profile Page", endpoint, data: stats, error: null })
    } catch (err) {
      calls.push({
        label: "Profile Page",
        endpoint,
        data: null,
        error: err instanceof Error ? err.message : "Request failed",
      })
    }

    return calls
  }
}
