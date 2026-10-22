// src/app/api/trackers/[id]/captcha/route.ts
//
// Functions: loadCaptchaTracker, fetchCaptchaImage, GET, POST
//
// The login captcha of a tracker, which the user answers on the tracker page.
// The server fetches the image, so the browser makes no request to the tracker.

import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { registryEntryFor } from "@/data/tracker-registry"
import {
  authenticate,
  decodeKey,
  parseJsonBody,
  parseTrackerId,
  type RouteContext,
} from "@/lib/api-helpers"
import { decrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import { trackers } from "@/lib/db/schema"
import { errMsg, sanitizeNetworkError } from "@/lib/error-utils"
import { flareSolverrFor } from "@/lib/flaresolverr-config"
import { CAPTCHA_ANSWER_MAX, CAPTCHA_IMAGE_MAX_BYTES } from "@/lib/limits"
import { log } from "@/lib/logger"
import { runManualPoll } from "@/lib/manual-poll"
import { isUnsafeNetworkHost } from "@/lib/network"
import { buildFetchOptions, getAdapter, type TrackerAdapter } from "@/lib/tracker-platforms"

const IMAGE_FETCH_TIMEOUT_MS = 5000

interface CaptchaTracker {
  adapter: Required<Pick<TrackerAdapter, "pendingCaptcha" | "submitCaptcha">>
  baseUrl: string
  apiToken: string
  useFlaresolverr: boolean
  registrySlug: string | null
  remoteUserId: number | null
}

async function loadCaptchaTracker(
  trackerId: number,
  key: Buffer
): Promise<CaptchaTracker | NextResponse> {
  const [tracker] = await db
    .select({
      name: trackers.name,
      baseUrl: trackers.baseUrl,
      platformType: trackers.platformType,
      registrySlug: trackers.registrySlug,
      encryptedApiToken: trackers.encryptedApiToken,
      isActive: trackers.isActive,
      useFlaresolverr: trackers.useFlaresolverr,
      remoteUserId: trackers.remoteUserId,
    })
    .from(trackers)
    .where(eq(trackers.id, trackerId))
    .limit(1)
  if (!tracker?.isActive) return NextResponse.json({ error: "Tracker not found" }, { status: 404 })

  const adapter = getAdapter(tracker.platformType)
  const { pendingCaptcha, submitCaptcha } = adapter
  if (!pendingCaptcha || !submitCaptcha) {
    return NextResponse.json({ error: "This tracker has no captcha" }, { status: 404 })
  }

  let apiToken: string
  try {
    apiToken = decrypt(tracker.encryptedApiToken, key)
  } catch {
    return NextResponse.json(
      { error: `API key is missing or invalid for tracker "${tracker.name}"` },
      { status: 400 }
    )
  }

  return {
    adapter: {
      pendingCaptcha: pendingCaptcha.bind(adapter),
      submitCaptcha: submitCaptcha.bind(adapter),
    },
    // The URL that polls use, which the captcha is stored under.
    baseUrl: registryEntryFor(tracker)?.url ?? tracker.baseUrl,
    apiToken,
    useFlaresolverr: tracker.useFlaresolverr,
    registrySlug: tracker.registrySlug,
    remoteUserId: tracker.remoteUserId,
  }
}

/** The image as a data: URL, or null when it cannot be fetched safely. */
async function fetchCaptchaImage(imageUrl: string): Promise<string | null> {
  let url: URL
  try {
    url = new URL(imageUrl)
  } catch {
    return null
  }
  if (url.protocol !== "https:" || isUnsafeNetworkHost(url.hostname)) return null
  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
    })
    const type = response.headers.get("content-type")?.split(";")[0].trim() ?? ""
    if (!response.ok || !type.startsWith("image/")) return null
    const declared = Number(response.headers.get("content-length") ?? "0")
    if (declared > CAPTCHA_IMAGE_MAX_BYTES) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > CAPTCHA_IMAGE_MAX_BYTES) return null
    return `data:${type};base64,${bytes.toString("base64")}`
  } catch {
    return null
  }
}

export async function GET(_request: Request, props: RouteContext) {
  const auth = await authenticate()
  if (auth instanceof NextResponse) return auth

  const trackerId = await parseTrackerId(props.params)
  if (trackerId instanceof NextResponse) return trackerId

  const tracker = await loadCaptchaTracker(trackerId, decodeKey(auth))
  if (tracker instanceof NextResponse) return tracker

  try {
    const pending = await tracker.adapter.pendingCaptcha(tracker.baseUrl, tracker.apiToken)
    if (!pending) return NextResponse.json({ pending: false })
    return NextResponse.json({
      pending: true,
      image: await fetchCaptchaImage(pending.imageUrl),
      expiresAt: pending.expiresAt,
    })
  } catch (err) {
    log.warn(
      { route: "GET /api/trackers/[id]/captcha", trackerId, error: errMsg(err) },
      "captcha lookup failed"
    )
    return NextResponse.json({ error: "Captcha lookup failed" }, { status: 500 })
  }
}

export async function POST(request: Request, props: RouteContext) {
  const auth = await authenticate()
  if (auth instanceof NextResponse) return auth

  const trackerId = await parseTrackerId(props.params)
  if (trackerId instanceof NextResponse) return trackerId

  const body = await parseJsonBody(request)
  if (body instanceof NextResponse) return body
  const answer = typeof body.answer === "string" ? body.answer.trim() : ""
  if (!answer || answer.length > CAPTCHA_ANSWER_MAX) {
    return NextResponse.json(
      { error: `Answer must be 1 to ${CAPTCHA_ANSWER_MAX} characters` },
      { status: 400 }
    )
  }

  const key = decodeKey(auth)
  const tracker = await loadCaptchaTracker(trackerId, key)
  if (tracker instanceof NextResponse) return tracker

  try {
    const options = buildFetchOptions({
      registrySlug: tracker.registrySlug,
      remoteUserId: tracker.remoteUserId ?? undefined,
      flaresolverr: await flareSolverrFor(tracker),
    })
    await tracker.adapter.submitCaptcha(tracker.baseUrl, tracker.apiToken, answer, options)
  } catch (err) {
    const raw = errMsg(err)
    log.warn({ route: "POST /api/trackers/[id]/captcha", trackerId, error: raw }, "captcha refused")
    return NextResponse.json(
      { error: sanitizeNetworkError(raw, "Captcha submission failed") },
      { status: 422 }
    )
  }

  // After a successful login, run the same poll as Poll Now, which also clears the
  // error and the pause.
  const poll = await runManualPoll(trackerId, key, "POST /api/trackers/[id]/captcha")
  return NextResponse.json(
    poll.ok
      ? { success: true, polled: true }
      : { success: true, polled: false, pollError: poll.error }
  )
}
