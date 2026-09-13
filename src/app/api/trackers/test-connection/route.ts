// src/app/api/trackers/test-connection/route.ts
import { NextResponse } from "next/server"
import { DEFAULT_API_PATHS, VALID_PLATFORM_TYPES } from "@/data/platform-types"
import {
  authenticate,
  decodeKey,
  parseJsonBody,
  validateHttpUrl,
  validateMaxLength,
} from "@/lib/api-helpers"
import { stripTrailingSlash } from "@/lib/data-transforms"
import { db } from "@/lib/db"
import { appSettings } from "@/lib/db/schema"
import { sanitizeNetworkError } from "@/lib/error-utils"
import { LONG_STRING_MAX, maxTokenLengthFor, TRACKER_URL_MAX } from "@/lib/limits"
import { log } from "@/lib/logger"
import { buildFetchOptions, getAdapter } from "@/lib/tracker-platforms"
import { buildProxyAgentFromSettings } from "@/lib/tunnel"

export async function POST(request: Request) {
  const auth = await authenticate()
  if (auth instanceof NextResponse) return auth

  const body = await parseJsonBody(request)
  if (body instanceof NextResponse) return body

  const { baseUrl, apiToken, platformType, apiPath } = body as {
    baseUrl?: string
    apiToken?: string
    platformType?: string
    apiPath?: string
  }

  if (!baseUrl || typeof baseUrl !== "string" || !apiToken || typeof apiToken !== "string") {
    return NextResponse.json({ error: "baseUrl and apiToken are required" }, { status: 400 })
  }

  // Stripped exactly as POST /api/trackers stores it. Without this the test
  // probes a URL the save then rewrites, so the two disagree about what was
  // proven: a pasted trailing slash gives the concatenating adapters a doubled
  // separator here and not once saved.
  const trimmedBaseUrl = stripTrailingSlash(baseUrl.trim())
  const trimmedApiToken = apiToken.trim()
  const platform = typeof platformType === "string" ? platformType : "unit3d"

  const maxTokenLength = maxTokenLengthFor(platform)
  const tokenErr = validateMaxLength(trimmedApiToken, maxTokenLength, "API token")
  if (tokenErr) return tokenErr

  const urlLenErr = validateMaxLength(trimmedBaseUrl, TRACKER_URL_MAX, "URL")
  if (urlLenErr) return urlLenErr

  const urlErr = validateHttpUrl(trimmedBaseUrl)
  if (urlErr) return urlErr

  if (!VALID_PLATFORM_TYPES.includes(platform as (typeof VALID_PLATFORM_TYPES)[number])) {
    return NextResponse.json({ error: "Invalid platform type" }, { status: 400 })
  }

  try {
    const key = decodeKey(auth)
    const [settings] = await db
      .select({
        proxyEnabled: appSettings.proxyEnabled,
        proxyType: appSettings.proxyType,
        proxyHost: appSettings.proxyHost,
        proxyPort: appSettings.proxyPort,
        proxyUsername: appSettings.proxyUsername,
        encryptedProxyPassword: appSettings.encryptedProxyPassword,
      })
      .from(appSettings)
      .limit(1)

    const proxyAgent = settings ? buildProxyAgentFromSettings(settings, key) : undefined

    const adapter = getAdapter(platform)
    const defaultPath = DEFAULT_API_PATHS[platform] ?? "/api/user"
    const rawPath = typeof apiPath === "string" && apiPath.startsWith("/") ? apiPath : defaultPath
    const pathLenErr = validateMaxLength(rawPath, LONG_STRING_MAX, "API path")
    if (pathLenErr) return pathLenErr
    const path = rawPath
    const fetchOptions = buildFetchOptions(trimmedBaseUrl, {
      proxyAgent: proxyAgent ?? undefined,
    })
    const stats = await adapter.fetchStats(trimmedBaseUrl, trimmedApiToken, path, fetchOptions)

    const result: Record<string, unknown> = {
      success: true,
      username: stats.username,
      group: stats.group,
    }

    return NextResponse.json(result)
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    const safeError = sanitizeNetworkError(raw, "Tracker test failed")
    log.warn(
      {
        route: "POST /api/trackers/test-connection",
        platform,
        baseUrl: trimmedBaseUrl,
        error: raw,
      },
      `tracker test failed: ${safeError}`
    )
    return NextResponse.json({ error: safeError }, { status: 422 })
  }
}
