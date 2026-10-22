// src/lib/tracker-platforms/adapters/rutracker.ts
//
// Functions: parseRutrackerCredentials, assertSignedIn, extractFormToken, parseUtcOffset,
//            zoneSuffix, hasUnreadMessages, parseNewsDates, parseRutrackerNews, parseRutrackerIndex,
//            parseRutrackerInbox, siteBytes, detailsRow, parseReleases, parseRutrackerProfile,
//            englishRank, englishTenure, bytesField, parseTrafStats, parseSeedingCount,
//            parseRutrackerCaptcha, requireSolver, sessionKey, dropCaptcha, holdCaptcha, liveCaptcha,
//            isLoginPage, login, buildInbox, pause, RutrackerAdapter

import { randomBytes, scrypt } from "node:crypto"
import { type HTMLElement as ParsedElement, parse as parseHtml } from "node-html-parser"
import { log } from "@/lib/logger"
import type {
  DebugApiCall,
  FetchOptions,
  FlareSolverrConfig,
  InboxMessage,
  NewsItem,
  PendingCaptcha,
  RuTrackerPlatformMeta,
  TrackerAdapter,
  TrackerInbox,
  TrackerOverview,
} from "../contract"
import { parseCredentialJson } from "../helpers/cookie-credentials"
import { SessionExpiredError } from "../helpers/errors"
import {
  createSolverSession,
  destroySolverSession,
  type SolverCookie,
  type SolverResult,
  solverClearance,
  solverGet,
  solverPostForm,
  unwrapSolverJson,
} from "../helpers/flaresolverr"
import {
  isCloudflareChallenge,
  normalizeWhitespace,
  tryParseCount,
  tryParseSiteBytes,
} from "../helpers/html-parse"

// RuTracker has no API and shows no download figure, so a poll is an account
// overview: the signed-in header contains the account, the profile contains the
// role and other details, and the profile's AJAX call and seeding list provide
// the upload figures when upload statistics are switched on. The site's pages
// are behind a Cloudflare challenge, so every request goes through FlareSolverr,
// in one browser session per poll, logged in with the username and password.

const LABEL = "RuTracker"
/** The site's charset, which a submitted form must be encoded in. */
const SITE_CHARSET = "windows-1251"
const SESSION_EXPIRED = "Session expired. The RuTracker session is logged out"
const SOLVER_REQUIRED =
  "RuTracker requires FlareSolverr: set it in Settings and enable it for this tracker"
const CAPTCHA_NEEDED = "Enter the RuTracker captcha on the tracker page"
const CAPTCHA_WRONG = "Wrong captcha, try the new one"
const NO_CAPTCHA = "No RuTracker captcha is pending"
/** How long an unanswered captcha, and the browser session it belongs to, is kept. */
const CAPTCHA_TTL_MS = 10 * 60 * 1000
/** Besides the tracker's own host, where the site serves captcha images from. */
const CAPTCHA_IMAGE_HOSTS = ["static.rutracker.cc"]
const LOGIN_PATTERN = /login\.php/i
/** Spacing between the requests of one poll, as Gazelle's enrichment does. */
const REQUEST_GAP_MS = 1500
/** The profile's seeding list stops at this many rows. */
const SEEDING_LIST_CAP = 100

/** The site's own zone (GMT+3), used when the footer shows none. */
const DEFAULT_UTC_OFFSET_MINUTES = 180
const INBOX_PATH = "/forum/privmsg.php?folder=inbox"
/**
 * A light page that contains the signed-in header, used for the first request
 * and as the login redirect. The index takes 30 to 45 s through FlareSolverr.
 */
const LANDING_PATH = INBOX_PATH
/** English names for the site's roles and titles; a name missing here is shown as printed. */
const RANK_NAMES: Record<string, string> = {
  пользователь: "User",
  "участник групп": "Group Member",
  модератор: "Moderator",
  "старший модератор": "Senior Moderator",
  "модератор-стажёр": "Trainee Moderator",
  "модератор-стажер": "Trainee Moderator",
  "помощник модератора": "Moderator Assistant",
  администратор: "Administrator",
  "техническая помощь": "Technical Support",
  хранитель: "Keeper",
  хранители: "Keepers",
  старожил: "Oldie",
  старожилы: "Oldie",
}
/** Qualifiers the site appends in parentheses, as in "VIP (Адм)". */
const RANK_QUALIFIERS: Record<string, string> = { адм: "Adm", неактивен: "inactive" }
/** Tenure units by the start of the Russian word, which changes its ending with the number. */
const TENURE_UNITS: [prefix: string, unit: string][] = [
  ["лет", "year"],
  ["год", "year"],
  ["мес", "month"],
  ["нед", "week"],
  ["д", "day"],
  ["час", "hour"],
  ["мин", "minute"],
]

const RU_MONTHS = [
  "янв",
  "фев",
  "мар",
  "апр",
  "май",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
]

export interface RutrackerCredentials {
  username: string
  password: string
}

export function parseRutrackerCredentials(apiToken: string): RutrackerCredentials {
  const { username, password } = parseCredentialJson(apiToken, LABEL, [
    "username",
    "password",
  ] as const)
  // Never trimmed: leading or trailing spaces are part of the secret.
  return { username: username.trim(), password }
}

/** A challenge or a guest page served with a 200 is not the member's page. */
function assertSignedIn(html: string, doc: ParsedElement): void {
  if (isCloudflareChallenge(html)) {
    throw new Error(
      "Cloudflare challenge detected. It was not solved through FlareSolverr for RuTracker"
    )
  }
  if (!doc.querySelector("#logged-in-username")) {
    throw new SessionExpiredError(SESSION_EXPIRED)
  }
}

/** `form_token: '<hex>'` in the page's inline `window.BB` settings. */
function extractFormToken(html: string): string | undefined {
  return html.match(/form_token\s*:\s*'([0-9a-f]{16,64})'/i)?.[1]
}

/** The account's zone from the footer, "Часовой пояс: GMT + 3", in minutes east of UTC. */
function parseUtcOffset(html: string): number {
  const match = html.match(/Часовой пояс:\s*<span[^>]*>\s*GMT\s*([+-])\s*(\d+(?:\.\d+)?)/)
  if (!match) return DEFAULT_UTC_OFFSET_MINUTES
  const minutes = Math.round(Number.parseFloat(match[2]) * 60)
  return match[1] === "-" ? -minutes : minutes
}

/** An ISO 8601 offset ("+03:00") for minutes east of UTC. */
function zoneSuffix(offsetMinutes: number): string {
  const abs = Math.abs(offsetMinutes)
  const hours = String(Math.floor(abs / 60)).padStart(2, "0")
  return `${offsetMinutes < 0 ? "-" : "+"}${hours}:${String(abs % 60).padStart(2, "0")}`
}

/**
 * The header contains no count, only a flag: the top menu has the `new-pm` class
 * and the ЛС link text includes "(есть новые)".
 */
function hasUnreadMessages(doc: ParsedElement): boolean {
  return (
    doc.querySelector(".topmenu.new-pm, a.new-pm-link") !== null ||
    (
      doc.querySelector('.top-menus a[href="privmsg.php?folder=inbox"]')?.textContent ?? ""
    ).includes("есть новые")
  )
}

/**
 * News dates are "18-Сен", day and month with no year, newest first. The year
 * starts at the current one in the site's zone and steps back whenever a date
 * is later in the year than the one above it.
 */
function parseNewsDates(
  labels: string[],
  now: Date,
  offsetMinutes: number
): (string | undefined)[] {
  const local = new Date(now.getTime() + offsetMinutes * 60_000)
  let year = local.getUTCFullYear()
  let previous = (local.getUTCMonth() + 1) * 100 + local.getUTCDate()
  const zone = zoneSuffix(offsetMinutes)
  return labels.map((label) => {
    const match = label.match(/^(\d{1,2})-(\p{L}{3})/u)
    const month = match ? RU_MONTHS.indexOf(match[2].toLowerCase()) + 1 : 0
    if (!match || month === 0) return undefined
    const day = Number.parseInt(match[1], 10)
    const key = month * 100 + day
    if (key > previous) year -= 1
    previous = key
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00${zone}`
  })
}

/** "Новости трекера" on the index: `#latest-news-table` rows, newest first. */
function parseRutrackerNews(
  doc: ParsedElement,
  baseUrl: string,
  now: Date,
  offsetMinutes: number
): NewsItem[] {
  const rows = doc
    .querySelectorAll("#latest-news-table tr")
    .map((row) => {
      const link = row.querySelector(".news_title a")
      const id = link?.getAttribute("href")?.match(/[?&]t=(\d+)/)?.[1]
      const title = normalizeWhitespace(link?.textContent ?? "")
      const date = normalizeWhitespace(row.querySelector(".news_date")?.textContent ?? "")
      return id && title ? { id, title, date } : null
    })
    .filter((row) => row !== null)
  const dates = parseNewsDates(
    rows.map((row) => row.date),
    now,
    offsetMinutes
  )
  return rows.map((row, i) => ({
    id: row.id,
    kind: "news" as const,
    title: row.title,
    publishedAt: dates[i],
    url: new URL(`/forum/viewtopic.php?t=${row.id}`, baseUrl).toString(),
  }))
}

export interface RutrackerIndex {
  username: string
  userId: number
  formToken?: string
  hasUnreadMessages: boolean
  /** Minutes east of UTC that the site prints times in for this account */
  utcOffsetMinutes: number
  news: NewsItem[]
}

export function parseRutrackerIndex(
  html: string,
  hostname: string,
  baseUrl = `https://${hostname}`,
  now = new Date()
): RutrackerIndex {
  const doc = parseHtml(html)
  assertSignedIn(html, doc)

  const link = doc.querySelector("#logged-in-username")
  const username = normalizeWhitespace(link?.textContent ?? "")
  const userId = Number.parseInt(link?.getAttribute("href")?.match(/[?&]u=(\d+)/)?.[1] ?? "", 10)
  if (!username || !Number.isFinite(userId) || userId <= 0) {
    throw new Error(`Unexpected response from ${hostname}: no username in the RuTracker header`)
  }
  const utcOffsetMinutes = parseUtcOffset(html)
  return {
    username,
    userId,
    formToken: extractFormToken(html),
    hasUnreadMessages: hasUnreadMessages(doc),
    utcOffsetMinutes,
    news: parseRutrackerNews(doc, baseUrl, now, utcOffsetMinutes),
  }
}

/**
 * The unread rows (`pm-unread`) of the inbox folder. Times are printed
 * "YYYY-MM-DD HH:MM" in the account's zone. No row shows whether staff sent it.
 */
export function parseRutrackerInbox(
  html: string,
  baseUrl: string,
  offsetMinutes: number
): InboxMessage[] {
  const doc = parseHtml(html)
  assertSignedIn(html, doc)
  if (!doc.querySelector('form[name="privmsg_list"]')) {
    throw new Error(`Unexpected response from ${new URL(baseUrl).hostname}: no RuTracker inbox`)
  }
  const zone = zoneSuffix(offsetMinutes)

  const messages: InboxMessage[] = []
  for (const row of doc.querySelectorAll('form[name="privmsg_list"] tr.pm-row.pm-unread')) {
    const link = row.querySelector('a[href*="mode=read"]')
    const id =
      link?.getAttribute("href")?.match(/[?&;]p=(\d+)/)?.[1] ?? row.id.match(/^tr-(\d+)$/)?.[1]
    if (!id) continue
    const sender = normalizeWhitespace(row.querySelector(".pm-nick-td a.med")?.textContent ?? "")
    const sent = normalizeWhitespace(row.querySelector("td.med")?.textContent ?? "").match(
      /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/
    )
    messages.push({
      id,
      subject: normalizeWhitespace(link?.textContent ?? ""),
      sender: sender || null,
      sentAt: sent ? `${sent[1]}T${sent[2]}:00${zone}` : undefined,
      url: new URL(`/forum/privmsg.php?folder=inbox&mode=read&p=${id}`, baseUrl).toString(),
    })
  }
  return messages
}

/**
 * A size as the site prints it ("2.86&nbsp;GB", "&middot; 976.96 GB") in bytes.
 * The site's units are binary whatever it calls them: 5511890221000 bytes is
 * printed as 5.013 TB.
 */
function siteBytes(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined
  const text = normalizeWhitespace(value.replace(/&nbsp;/g, " "))
    .replace(/^·\s*/, "")
    .replace(/([KMGTP])B$/i, "$1iB")
  const size = tryParseSiteBytes(text)
  return size === undefined ? undefined : Number(size)
}

/** The value cell beside a `th` label in the profile's details table. */
function detailsRow(doc: ParsedElement, label: string): ParsedElement | undefined {
  for (const row of doc.querySelectorAll("table.user_details tr")) {
    const th = row.querySelector("th")
    if (th && normalizeWhitespace(th.textContent).startsWith(label)) {
      return row.querySelector("td") ?? undefined
    }
  }
  return undefined
}

/** "Раздачи:": all releases, then the verified ones after the approved mark. */
function parseReleases(cell: ParsedElement | undefined): Partial<RuTrackerPlatformMeta> {
  if (!cell) return {}
  const meta: Partial<RuTrackerPlatformMeta> = {}
  const all = cell.querySelector('a[href*="tracker.php?rid="]')
  if (all) {
    const bolds = all.querySelectorAll("b")
    meta.releases = tryParseCount(bolds[0]?.textContent)
    meta.releasesBytes = siteBytes(bolds[1]?.textContent)
  }
  const verified = cell.querySelector(".tor-approved")?.parentNode
  if (verified) {
    const text = normalizeWhitespace(verified.textContent).replace(/^√\s*/, "")
    meta.verifiedReleases = tryParseCount(text)
    meta.verifiedReleasesBytes = siteBytes(verified.querySelector(".seedmed")?.textContent)
  }
  // Undefined members are left out rather than set, so JSON stores no key for them.
  return Object.fromEntries(
    Object.entries(meta).filter(([, value]) => value !== undefined)
  ) as Partial<RuTrackerPlatformMeta>
}

export interface RutrackerProfile {
  group: string | null
  joinedDate?: string
  avatarUrl?: string
  formToken?: string
  /** The profile contains the seeding list heading, present only when statistics are on. */
  hasSeedingList: boolean
  meta: RuTrackerPlatformMeta
}

function englishRank(name: string): string {
  const match = name.match(/^(.*?)\s*(?:\(([^)]*)\))?$/)
  const base = (match?.[1] ?? name).trim()
  const qualifier = match?.[2]?.trim()
  const english = RANK_NAMES[base.toLowerCase()] ?? base
  if (!qualifier) return english
  return `${english} (${RANK_QUALIFIERS[qualifier.toLowerCase()] ?? qualifier})`
}

/** "18 лет 6 месяцев" as "18 years 6 months"; text with an unknown unit is returned unchanged. */
function englishTenure(text: string): string {
  const parts = [...text.matchAll(/(\d+)\s*([а-яё]+)\.?/gi)]
  if (parts.length === 0 || parts.map((p) => p[0]).join(" ") !== text.replace(/\s+/g, " ").trim()) {
    return text
  }
  const english: string[] = []
  for (const [, count, word] of parts) {
    const unit = TENURE_UNITS.find(([prefix]) => word.toLowerCase().startsWith(prefix))?.[1]
    if (!unit) return text
    english.push(`${count} ${unit}${count === "1" ? "" : "s"}`)
  }
  return english.join(" ")
}

export function parseRutrackerProfile(
  html: string,
  hostname: string,
  baseUrl: string
): RutrackerProfile {
  const doc = parseHtml(html)
  assertSignedIn(html, doc)

  const roleCell = doc.querySelector("#role")
  if (!doc.querySelector("table.user_details") || !roleCell) {
    throw new Error(`Unexpected response from ${hostname}: no RuTracker profile table`)
  }

  const meta: RuTrackerPlatformMeta = {}

  const role = normalizeWhitespace(roleCell.querySelector("b:not(#ban-msg)")?.textContent ?? "")
  if (role) meta.role = englishRank(role)

  // "Звание: <b>VIP (Адм)</b>", or "нет" for none. For a rank shown only as an
  // image, the name is in the image title.
  let title: string | undefined
  for (const div of doc.querySelectorAll(".user_profile .med.mrg_4")) {
    const text = normalizeWhitespace(div.textContent)
    if (!text.startsWith("Звание:")) continue
    const value = text.slice("Звание:".length).trim()
    if (value && value.toLowerCase() !== "нет") title = value
  }
  if (!title) {
    const imageTitle = doc.querySelector("#rank-img img")?.getAttribute("title")?.trim()
    if (imageTitle) title = imageTitle
  }
  if (title) meta.title = englishRank(title)

  const banNote = normalizeWhitespace(doc.querySelector("#ban-msg")?.textContent ?? "")
  meta.restricted = banNote.length > 0
  if (banNote) meta.restrictionNote = banNote

  const tenure = normalizeWhitespace(detailsRow(doc, "Стаж:")?.textContent ?? "")
  if (tenure) meta.tenure = englishTenure(tenure)

  const joined = normalizeWhitespace(detailsRow(doc, "Зарегистрирован:")?.textContent ?? "")
  const joinedDate = joined.match(/\d{4}-\d{2}-\d{2}/)?.[0]

  // The profile prints zero posts as "Нет".
  const posts = doc.querySelector("#posts")
  if (posts) {
    const text = normalizeWhitespace(posts.textContent)
    const count = /^нет$/i.test(text) ? 0 : tryParseCount(posts.querySelector("b")?.textContent)
    if (count !== undefined) meta.posts = count
  }

  Object.assign(meta, parseReleases(detailsRow(doc, "Раздачи:")))

  if (detailsRow(doc, "Статистика отключена:")) meta.statsEnabled = false
  else if (doc.querySelector("#traf-stats-tbl")) meta.statsEnabled = true

  const hasSeedingList = doc
    .querySelectorAll("h1.pagetitle")
    .some((h) => h.textContent.includes("Сидируемые раздачи"))

  const avatarSrc = doc.querySelector("#avatar-img img")?.getAttribute("src")
  let avatarUrl: string | undefined
  if (avatarSrc) {
    try {
      avatarUrl = new URL(avatarSrc, baseUrl).href
    } catch {
      avatarUrl = undefined
    }
  }

  return {
    group: meta.title ?? meta.role ?? null,
    joinedDate,
    avatarUrl,
    formToken: extractFormToken(html),
    hasSeedingList,
    meta,
  }
}

/** An exact byte string ("193027526010024") as a number, or undefined. */
function bytesField(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

/** The profile's `get_traf_stats` AJAX reply. */
export function parseTrafStats(body: string, hostname: string): Partial<RuTrackerPlatformMeta> {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(body) as Record<string, unknown>
  } catch {
    throw new Error(`Unexpected response from ${hostname}: upload statistics were not JSON`)
  }
  if (typeof data !== "object" || data === null) {
    throw new Error(`Unexpected response from ${hostname}: upload statistics were not an object`)
  }
  const uploadedBytes = bytesField(data.uploaded_total_byte)
  if (uploadedBytes === undefined) {
    throw new Error(`Unexpected response from ${hostname}: no upload total in the statistics`)
  }
  // Undefined members are left out rather than set, so JSON stores no key for them.
  const figures: Partial<Record<keyof RuTrackerPlatformMeta, number | undefined>> = {
    uploadedBytes,
    uploadedTodayBytes: siteBytes(data.uploaded_day),
    uploadedYesterdayBytes: siteBytes(data.up_yesterday),
    rareUploadedBytes: bytesField(data.up_rare_total_byte),
    rareUploadedTodayBytes: siteBytes(data.up_rare_day),
    rareUploadedYesterdayBytes: siteBytes(data.up_rare_yesterday),
  }
  return Object.fromEntries(
    Object.entries(figures).filter(([, value]) => value !== undefined)
  ) as Partial<RuTrackerPlatformMeta>
}

/** "Сидируемые раздачи: <b>N</b>", or "нет" for none. */
export function parseSeedingCount(html: string): number | undefined {
  const doc = parseHtml(html)
  const heading = doc
    .querySelectorAll("h1.pagetitle")
    .find((h) => h.textContent.includes("Сидируемые раздачи"))
  if (!heading) return undefined
  const count = heading.querySelector("b")
  if (count) return tryParseCount(count.textContent)
  return /нет/i.test(heading.textContent) ? 0 : undefined
}

export interface RutrackerCaptcha {
  imageUrl: string
  capSid: string
  /** The answer's field name, `cap_code_<hash>`, which changes with each captcha */
  codeField: string
}

/**
 * The captcha in a login form, or null when there is none. The image must be
 * an https URL on the tracker or its static host, since the server fetches it.
 */
export function parseRutrackerCaptcha(html: string, baseUrl: string): RutrackerCaptcha | null {
  const doc = parseHtml(html)
  const capSid = doc.querySelector('input[name="cap_sid"]')?.getAttribute("value")
  const codeField = doc
    .querySelectorAll("input")
    .map((input) => input.getAttribute("name") ?? "")
    .find((name) => /^cap_code_[0-9a-z]+$/i.test(name))
  const src = doc.querySelector('img[src*="/captcha/"]')?.getAttribute("src")
  if (!capSid || !codeField || !src) return null
  let image: URL
  try {
    image = new URL(src, baseUrl)
  } catch {
    return null
  }
  const allowedHost =
    CAPTCHA_IMAGE_HOSTS.includes(image.hostname) || image.hostname === new URL(baseUrl).hostname
  if (image.protocol !== "https:" || !allowedHost) return null
  return { imageUrl: image.href, capSid, codeField }
}

// Logging in on every poll would post the password hourly, and RuTracker shows a
// captcha after repeated logins. The bb_session cookie is cached across polls,
// keyed by a hash of the credentials as for TorrentLeech, and passed to each
// poll's new browser session. The cache is in memory only.

const gRt = globalThis as typeof globalThis & {
  __rutrackerSessionCache?: Map<string, string>
  __rutrackerSessionSalt?: Buffer
}
if (!gRt.__rutrackerSessionCache) gRt.__rutrackerSessionCache = new Map()
if (!gRt.__rutrackerSessionSalt) gRt.__rutrackerSessionSalt = randomBytes(16)
const sessionCache = gRt.__rutrackerSessionCache
const sessionSalt = gRt.__rutrackerSessionSalt

// A captcha waiting for the user's answer, stored with the FlareSolverr session
// it was shown in because the captcha may depend on that session's cookies.
// Keyed like the session cache. The session is destroyed when the captcha
// expires or is replaced.
interface HeldCaptcha extends RutrackerCaptcha {
  solver: FlareSolverrConfig
  session: string
  expiresAt: number
  timer: ReturnType<typeof setTimeout>
}

const gRtCaptcha = globalThis as typeof globalThis & {
  __rutrackerCaptchas?: Map<string, HeldCaptcha>
}
if (!gRtCaptcha.__rutrackerCaptchas) gRtCaptcha.__rutrackerCaptchas = new Map()
const captchas = gRtCaptcha.__rutrackerCaptchas
// Taken at load so a test's fake clock cannot fire the expiry early; whether a
// captcha has expired is read from Date.now() whenever it is looked up.
const expiryTimer = { set: setTimeout, clear: clearTimeout }

/** Removes the captcha and destroys its session, unless it is `keepSession`. */
function dropCaptcha(key: string, keepSession?: string): void {
  const held = captchas.get(key)
  if (!held) return
  expiryTimer.clear(held.timer)
  captchas.delete(key)
  if (held.session !== keepSession) void destroySolverSession(held.solver, held.session)
}

function holdCaptcha(
  key: string,
  solver: FlareSolverrConfig,
  session: string,
  captcha: RutrackerCaptcha
): void {
  dropCaptcha(key, session)
  const timer = expiryTimer.set(() => dropCaptcha(key), CAPTCHA_TTL_MS)
  timer.unref?.()
  captchas.set(key, { ...captcha, solver, session, expiresAt: Date.now() + CAPTCHA_TTL_MS, timer })
}

function liveCaptcha(key: string): HeldCaptcha | undefined {
  const held = captchas.get(key)
  if (held && held.expiresAt <= Date.now()) {
    dropCaptcha(key)
    return undefined
  }
  return held
}

function requireSolver(options?: FetchOptions): FlareSolverrConfig {
  if (!options?.flaresolverr) throw new Error(SOLVER_REQUIRED)
  return options.flaresolverr
}

function sessionKey(baseUrl: string, creds: RutrackerCredentials): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(`${creds.username}\u0000${creds.password}`, sessionSalt, 32, (err, derived) => {
      if (err) reject(err)
      else resolve(`${baseUrl}|${derived.toString("hex")}`)
    })
  })
}

/** The login form, on the login page or the guest index. */
function isLoginPage(html: string): boolean {
  return /name="login_username"/.test(html)
}

type LoginOutcome =
  { kind: "signed-in"; result: SolverResult } | { kind: "captcha"; captcha: RutrackerCaptcha }

/**
 * Submits the login form in the browser session, with the answer to a captcha
 * when there is one. The password goes only into the submitted form.
 */
async function login(
  solver: FlareSolverrConfig,
  session: string,
  baseUrl: string,
  creds: RutrackerCredentials,
  captcha?: { capSid: string; codeField: string; answer: string }
): Promise<LoginOutcome> {
  const result = await solverPostForm(
    solver,
    `${baseUrl}/forum/login.php`,
    {
      redirect: LANDING_PATH.replace("/forum/", ""),
      login_username: creds.username,
      login_password: creds.password,
      login: "Вход",
      ...(captcha ? { cap_sid: captcha.capSid, [captcha.codeField]: captcha.answer } : {}),
    },
    { session, charset: SITE_CHARSET }
  )
  const html = result.html
  if (isCloudflareChallenge(html)) {
    throw new Error(
      "Cloudflare challenge detected. It was not solved through FlareSolverr for RuTracker"
    )
  }
  if (html.includes('id="logged-in-username"')) return { kind: "signed-in", result }
  const shown = parseRutrackerCaptcha(html, baseUrl)
  if (shown) return { kind: "captcha", captcha: shown }
  if (isLoginPage(html)) {
    throw new Error(
      "Invalid credentials: the RuTracker login failed with this username and password"
    )
  }
  throw new Error(
    `Unexpected response from ${new URL(baseUrl).hostname}: no RuTracker login result`
  )
}

/**
 * With the flag down nothing is unread, so the empty list marks earlier
 * messages read. With it up and the folder unreadable, the count is unknown.
 */
function buildInbox(
  baseUrl: string,
  index: RutrackerIndex,
  unread: InboxMessage[] | undefined,
  newsRead: boolean
): TrackerInbox {
  const messages = index.hasUnreadMessages ? unread : []
  return {
    unreadMessages: messages ? messages.length : null,
    unreadStaffMessages: null,
    unreadNotifications: null,
    ...(messages ? { messages } : {}),
    ...(newsRead ? { news: index.news } : {}),
    links: {
      inbox: new URL(INBOX_PATH, baseUrl).toString(),
      news: new URL("/forum/index.php", baseUrl).toString(),
    },
  }
}

function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS))
}

interface PollPages {
  index?: RutrackerIndex
  profile?: RutrackerProfile
  trafStats?: Partial<RuTrackerPlatformMeta>
  seedingCount?: number
  /** Unset when the inbox was not read, or its read failed */
  unread?: InboxMessage[]
  /** Whether the index, the only page with the news, was read */
  newsRead?: boolean
}

type Step = "session" | "header" | "login" | "profile" | "trafStats" | "seeding" | "index" | "inbox"

type OnStep = (step: Step, endpoint: string, data: unknown, error: unknown) => void

export class RutrackerAdapter implements TrackerAdapter {
  /**
   * The signed-in header and the profile are required. The statistics, the
   * seeding list, the news and the inbox are best-effort: a failure there is
   * reported to `onStep` and the poll continues without them.
   */
  private async readPages(
    baseUrl: string,
    creds: RutrackerCredentials,
    solver: FlareSolverrConfig,
    onStep: OnStep
  ): Promise<PollPages> {
    const hostname = new URL(baseUrl).hostname
    const key = await sessionKey(baseUrl, creds)

    // Best-effort: without the cookie the session solves the challenge itself, more slowly.
    let clearance: SolverCookie[] = []
    try {
      clearance = await solverClearance(solver, `${baseUrl}/forum/login.php`)
    } catch {
      clearance = []
    }

    let session: string
    try {
      session = await createSolverSession(solver)
    } catch (err) {
      onStep("session", "FlareSolverr", null, err)
      throw err
    }

    // Set when the session is kept open for a pending captcha.
    let sessionHeld = false
    try {
      const pages: PollPages = {}
      // A page that lands on the login form means the session was dropped.
      const get = async (path: string) => {
        const result = await solverGet(solver, `${baseUrl}${path}`, { session })
        if (LOGIN_PATTERN.test(new URL(result.url).pathname)) {
          throw new SessionExpiredError(SESSION_EXPIRED)
        }
        return result.html
      }
      const post = async (path: string, fields: Record<string, string>) => {
        const result = await solverPostForm(solver, `${baseUrl}${path}`, fields, {
          session,
          charset: SITE_CHARSET,
        })
        if (isCloudflareChallenge(result.html) || result.status >= 400) {
          throw new Error(`Unexpected response from ${hostname}: ${path} returned ${result.status}`)
        }
        return result.html
      }

      let landingHtml: string
      try {
        const cached = sessionCache.get(key)
        const result = await solverGet(solver, `${baseUrl}${LANDING_PATH}`, {
          session,
          cookies: [...clearance, ...(cached ? [{ name: "bb_session", value: cached }] : [])],
        })
        landingHtml = result.html
      } catch (err) {
        onStep("header", LANDING_PATH, null, err)
        throw err
      }

      if (!isCloudflareChallenge(landingHtml) && !landingHtml.includes('id="logged-in-username"')) {
        sessionCache.delete(key)
        try {
          // While a captcha is pending, the password is not posted again.
          if (liveCaptcha(key)) throw new Error(CAPTCHA_NEEDED)
          await pause()
          // The login page can show a captcha before anything is posted.
          const loginPage = await solverGet(solver, `${baseUrl}/forum/login.php`, { session })
          let captcha = parseRutrackerCaptcha(loginPage.html, baseUrl)
          if (!captcha) {
            await pause()
            const outcome = await login(solver, session, baseUrl, creds)
            if (outcome.kind === "captcha") {
              captcha = outcome.captcha
            } else {
              const bbSession = outcome.result.cookies.find((c) => c.name === "bb_session")?.value
              if (bbSession) sessionCache.set(key, bbSession)
              landingHtml = outcome.result.html
            }
          }
          if (captcha) {
            holdCaptcha(key, solver, session, captcha)
            sessionHeld = true
            throw new Error(CAPTCHA_NEEDED)
          }
          onStep("login", "/forum/login.php", { loggedIn: true }, null)
        } catch (err) {
          onStep("login", "/forum/login.php", null, err)
          throw err
        }
      }

      // Every page contains the header; only the index contains the news.
      try {
        pages.index = parseRutrackerIndex(landingHtml, hostname, baseUrl)
        onStep("header", LANDING_PATH, pages.index, null)
      } catch (err) {
        onStep("header", LANDING_PATH, null, err)
        throw err
      }
      const { userId } = pages.index

      await pause()
      const profileEndpoint = `/forum/profile.php?mode=viewprofile&u=${userId}`
      try {
        pages.profile = parseRutrackerProfile(await get(profileEndpoint), hostname, baseUrl)
        onStep("profile", profileEndpoint, pages.profile, null)
      } catch (err) {
        onStep("profile", profileEndpoint, null, err)
        throw err
      }

      const { profile } = pages
      const formToken = profile.formToken ?? pages.index.formToken
      // The AJAX call returns zeros when statistics are off, so it is made only
      // when the profile shows statistics as on.
      if (profile.meta.statsEnabled === true && formToken) {
        await pause()
        const ajaxEndpoint = "/forum/ajax.php"
        try {
          const body = await post(ajaxEndpoint, {
            action: "get_traf_stats",
            user_id: String(userId),
            form_token: formToken,
          })
          pages.trafStats = parseTrafStats(unwrapSolverJson(body), hostname)
          onStep("trafStats", ajaxEndpoint, pages.trafStats, null)
        } catch (err) {
          onStep("trafStats", ajaxEndpoint, null, err)
        }

        if (profile.hasSeedingList) {
          await pause()
          try {
            const html = await post(profileEndpoint, { form_token: formToken, show_seeding: "1" })
            pages.seedingCount = parseSeedingCount(html)
            onStep("seeding", profileEndpoint, { seedingCount: pages.seedingCount ?? null }, null)
          } catch (err) {
            onStep("seeding", profileEndpoint, null, err)
          }
        }
      }

      await pause()
      const indexEndpoint = "/forum/index.php"
      try {
        const index = parseRutrackerIndex(await get(indexEndpoint), hostname, baseUrl)
        pages.index = { ...pages.index, utcOffsetMinutes: index.utcOffsetMinutes, news: index.news }
        pages.newsRead = true
        onStep("index", indexEndpoint, { news: index.news.length }, null)
      } catch (err) {
        onStep("index", indexEndpoint, null, err)
      }

      // The header shows only whether there is unread mail, so the folder is
      // requested only when there is.
      if (pages.index.hasUnreadMessages) {
        await pause()
        try {
          pages.unread = parseRutrackerInbox(
            await get(INBOX_PATH),
            baseUrl,
            pages.index.utcOffsetMinutes
          )
          onStep("inbox", INBOX_PATH, { unread: pages.unread.length }, null)
        } catch (err) {
          onStep("inbox", INBOX_PATH, null, err)
        }
      }

      return pages
    } finally {
      if (!sessionHeld) await destroySolverSession(solver, session)
    }
  }

  /** Once more after an expired session, with the cached cookie dropped. */
  private async readPagesWithRetry(
    baseUrl: string,
    creds: RutrackerCredentials,
    solver: FlareSolverrConfig,
    onStep: OnStep
  ): Promise<PollPages> {
    try {
      return await this.readPages(baseUrl, creds, solver, onStep)
    } catch (err) {
      if (!(err instanceof SessionExpiredError)) throw err
      sessionCache.delete(await sessionKey(baseUrl, creds))
      return this.readPages(baseUrl, creds, solver, onStep)
    }
  }

  async fetchStats(
    baseUrl: string,
    apiToken: string,
    _apiPath: string,
    options?: FetchOptions
  ): Promise<TrackerOverview> {
    const creds = parseRutrackerCredentials(apiToken)
    const solver = requireSolver(options)
    const pages = await this.readPagesWithRetry(baseUrl, creds, solver, (step, _e, _d, err) => {
      const optional = {
        trafStats: "upload statistics",
        seeding: "seeding list",
        index: "news",
        inbox: "inbox",
      }
      if (err && step in optional) {
        log.warn(
          { error: err instanceof Error ? err.message : String(err) },
          `rutracker: ${optional[step as keyof typeof optional]} unavailable, overview kept`
        )
      }
    })
    const { index, profile } = pages
    if (!index || !profile) {
      throw new Error(`Unexpected response from ${new URL(baseUrl).hostname}: incomplete poll`)
    }

    const meta: RuTrackerPlatformMeta = { ...profile.meta, ...pages.trafStats }
    if (pages.seedingCount !== undefined) {
      meta.seedingCount = pages.seedingCount
      meta.seedingCapped = pages.seedingCount >= SEEDING_LIST_CAP
    }

    const overview: TrackerOverview = {
      kind: "overview",
      username: index.username,
      group: profile.group,
      remoteUserId: index.userId,
      platformMeta: meta,
    }
    if (profile.joinedDate) overview.joinedDate = profile.joinedDate
    if (profile.avatarUrl) overview.avatarUrl = profile.avatarUrl
    overview.inbox = buildInbox(baseUrl, index, pages.unread, pages.newsRead === true)
    return overview
  }

  async pendingCaptcha(baseUrl: string, apiToken: string): Promise<PendingCaptcha | null> {
    const held = liveCaptcha(await sessionKey(baseUrl, parseRutrackerCredentials(apiToken)))
    return held
      ? { imageUrl: held.imageUrl, expiresAt: new Date(held.expiresAt).toISOString() }
      : null
  }

  async submitCaptcha(baseUrl: string, apiToken: string, answer: string): Promise<void> {
    const creds = parseRutrackerCredentials(apiToken)
    const key = await sessionKey(baseUrl, creds)
    const held = liveCaptcha(key)
    if (!held) throw new Error(NO_CAPTCHA)

    let outcome: LoginOutcome
    try {
      outcome = await login(held.solver, held.session, baseUrl, creds, {
        capSid: held.capSid,
        codeField: held.codeField,
        answer,
      })
    } catch (err) {
      dropCaptcha(key)
      throw err
    }
    // A wrong answer is followed by a new captcha in the same session.
    if (outcome.kind === "captcha") {
      holdCaptcha(key, held.solver, held.session, outcome.captcha)
      throw new Error(CAPTCHA_WRONG)
    }
    const bbSession = outcome.result.cookies.find((c) => c.name === "bb_session")?.value
    if (bbSession) sessionCache.set(key, bbSession)
    dropCaptcha(key)
  }

  async fetchRaw(
    baseUrl: string,
    apiToken: string,
    _apiPath: string,
    options?: FetchOptions
  ): Promise<DebugApiCall[]> {
    // Parsed outside the try so a malformed credential throws to the route.
    const creds = parseRutrackerCredentials(apiToken)
    const solver = requireSolver(options)
    const labels: Record<Step, string> = {
      session: "FlareSolverr Session",
      header: "Account Header",
      index: "Forum Index",
      login: "Login",
      profile: "Profile",
      trafStats: "Upload Statistics",
      seeding: "Seeding List",
      inbox: "Inbox",
    }
    const calls: DebugApiCall[] = []
    try {
      await this.readPagesWithRetry(baseUrl, creds, solver, (step, endpoint, data, err) => {
        calls.push({
          label: labels[step],
          endpoint,
          data: err ? null : data,
          error: err ? (err instanceof Error ? err.message : "Request failed") : null,
        })
      })
    } catch {
      // Already recorded as the failing call.
    }
    return calls
  }
}
