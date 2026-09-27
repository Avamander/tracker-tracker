// src/app/api/trackers/[id]/mousehole/route.ts
//
// Functions: GET, POST

import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { authenticate, parseTrackerId, type RouteContext } from "@/lib/api-helpers"
import { db } from "@/lib/db"
import { trackers } from "@/lib/db/schema"
import { log } from "@/lib/logger"
import {
  type MouseholeResult,
  type MouseholeStatusResponse,
  parseMouseholeUrl,
} from "@/lib/mousehole"

const GET_TIMEOUT_MS = 10_000
const POST_TIMEOUT_MS = 15_000

interface MouseholeState {
  hasCookie?: boolean
  nextContactAt?: string
  lastMamContact?: {
    at?: string
    reached?: boolean
    ip?: string
    asn?: number
    as?: string
    ipUpdate?: { success?: boolean; msg?: string; httpStatus?: number }
    error?: { type?: string; message?: string }
  }
}

interface MouseholeTarget {
  baseUrl: string
  headers: Record<string, string>
}

async function resolveMousehole(
  params: RouteContext["params"]
): Promise<NextResponse | MouseholeTarget> {
  const trackerId = await parseTrackerId(params)
  if (trackerId instanceof NextResponse) return trackerId

  const [tracker] = await db
    .select({ platformType: trackers.platformType, mouseholeUrl: trackers.mouseholeUrl })
    .from(trackers)
    .where(eq(trackers.id, trackerId))
    .limit(1)

  if (!tracker) {
    return NextResponse.json({ error: "Tracker not found" }, { status: 404 })
  }
  if (tracker.platformType !== "mam") {
    return NextResponse.json(
      { error: "Mousehole is only available for MAM trackers" },
      { status: 400 }
    )
  }
  if (!tracker.mouseholeUrl) {
    return NextResponse.json({ error: "Mousehole URL not configured" }, { status: 400 })
  }

  let parsed: ReturnType<typeof parseMouseholeUrl>
  try {
    parsed = parseMouseholeUrl(tracker.mouseholeUrl)
  } catch {
    return NextResponse.json({ error: "Invalid Mousehole URL in database" }, { status: 400 })
  }
  if (!/^https?:\/\//.test(parsed.baseUrl)) {
    return NextResponse.json({ error: "Mousehole URL must use http or https" }, { status: 400 })
  }

  const headers: Record<string, string> = { Accept: "application/json" }
  if (parsed.token) headers.Authorization = `Bearer ${parsed.token}`
  return { baseUrl: parsed.baseUrl, headers }
}

async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string } | null
  if (res.status === 401) {
    return "Mousehole rejected the token. Put MOUSEHOLE_AUTH_TOKEN in the URL as http://:<token>@host:port"
  }
  return body?.message?.trim() || `Mousehole returned HTTP ${res.status}`
}

function toResponse(
  result: MouseholeResult | null,
  state: MouseholeState | null,
  stateError: string | null
): MouseholeStatusResponse {
  const contact = state?.lastMamContact
  return {
    result,
    hasCookie: state?.hasCookie ?? null,
    ip: contact?.ip ?? null,
    asn: contact?.asn ?? null,
    asOrg: contact?.as ?? null,
    nextContactAt: state?.nextContactAt ?? null,
    lastContactAt: contact?.at ?? null,
    lastMessage: contact?.ipUpdate?.msg ?? contact?.error?.message ?? null,
    stateError,
  }
}

function failure(route: string, error: unknown): NextResponse {
  if (error instanceof Error && error.name === "AbortError") {
    log.warn({ route }, "Mousehole request timed out")
    return NextResponse.json({ error: "Mousehole request timed out" }, { status: 504 })
  }
  log.warn({ route, error: String(error) }, "Mousehole unreachable")
  return NextResponse.json({ error: "Mousehole unreachable" }, { status: 502 })
}

export async function GET(_request: Request, { params }: RouteContext) {
  const auth = await authenticate()
  if (auth instanceof NextResponse) return auth

  const target = await resolveMousehole(params)
  if (target instanceof NextResponse) return target

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GET_TIMEOUT_MS)

  try {
    const [healthRes, stateRes] = await Promise.all([
      fetch(`${target.baseUrl}/health`, { headers: target.headers, signal: controller.signal }),
      fetch(`${target.baseUrl}/state`, { headers: target.headers, signal: controller.signal }),
    ])
    clearTimeout(timer)

    if (!healthRes.ok) {
      return NextResponse.json({ error: await errorMessage(healthRes) }, { status: 502 })
    }
    const health = (await healthRes.json()) as { lastMamContactResult?: MouseholeResult }

    let state: MouseholeState | null = null
    let stateError: string | null = null
    if (stateRes.ok) {
      state = (await stateRes.json()) as MouseholeState
    } else {
      stateError = await errorMessage(stateRes)
    }

    return NextResponse.json(toResponse(health.lastMamContactResult ?? null, state, stateError))
  } catch (error) {
    clearTimeout(timer)
    return failure("GET /api/trackers/[id]/mousehole", error)
  }
}

export async function POST(_request: Request, { params }: RouteContext) {
  const auth = await authenticate()
  if (auth instanceof NextResponse) return auth

  const target = await resolveMousehole(params)
  if (target instanceof NextResponse) return target

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS)

  try {
    const res = await fetch(`${target.baseUrl}/updates`, {
      method: "POST",
      headers: target.headers,
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!res.ok) {
      return NextResponse.json({ error: await errorMessage(res) }, { status: 502 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    clearTimeout(timer)
    return failure("POST /api/trackers/[id]/mousehole", error)
  }
}
