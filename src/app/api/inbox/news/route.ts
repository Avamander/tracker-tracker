// src/app/api/inbox/news/route.ts
//
// Functions: POST

import { NextResponse } from "next/server"
import { authenticate, parseJsonBody } from "@/lib/api-helpers"
import { dismissNews } from "@/lib/tracker-inbox"

const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0

export async function POST(request: Request) {
  const auth = await authenticate()
  if (auth instanceof NextResponse) return auth

  const body = await parseJsonBody(request)
  if (body instanceof NextResponse) return body

  const { ids, trackerId } = body
  if (ids !== undefined && !(Array.isArray(ids) && ids.length <= 500 && ids.every(isId))) {
    return NextResponse.json({ error: "ids must be a list of news IDs" }, { status: 400 })
  }
  if (trackerId !== undefined && !isId(trackerId)) {
    return NextResponse.json({ error: "Invalid tracker ID" }, { status: 400 })
  }

  const dismissed = await dismissNews({ ids, trackerId })
  return NextResponse.json({ dismissed })
}
