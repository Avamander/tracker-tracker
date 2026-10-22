// src/app/api/trackers/[id]/poll/route.ts
import { NextResponse } from "next/server"
import { authenticate, decodeKey, parseTrackerId, type RouteContext } from "@/lib/api-helpers"
import { runManualPoll } from "@/lib/manual-poll"

export async function POST(_request: Request, props: RouteContext) {
  const auth = await authenticate()
  if (auth instanceof NextResponse) return auth

  const trackerId = await parseTrackerId(props.params)
  if (trackerId instanceof NextResponse) return trackerId

  const result = await runManualPoll(trackerId, decodeKey(auth), "POST /api/trackers/[id]/poll")
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true })
}
