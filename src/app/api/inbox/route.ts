// src/app/api/inbox/route.ts
//
// Functions: GET

import { NextResponse } from "next/server"
import { authenticate } from "@/lib/api-helpers"
import { createPrivacyMask } from "@/lib/privacy-db"
import { getInbox } from "@/lib/tracker-inbox"

export async function GET(request: Request) {
  const auth = await authenticate()
  if (auth instanceof NextResponse) return auth

  const raw = new URL(request.url).searchParams.get("trackerId")
  let trackerId: number | undefined
  if (raw !== null) {
    trackerId = Number(raw)
    if (!Number.isInteger(trackerId) || trackerId <= 0) {
      return NextResponse.json({ error: "Invalid tracker ID" }, { status: 400 })
    }
  }

  const trackers = await getInbox(await createPrivacyMask(), trackerId)
  return NextResponse.json({ trackers })
}
