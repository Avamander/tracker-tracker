// src/lib/adapters/animebytes.ts
//
// Functions: unwrapPersonalStats, AnimeBytesAdapter

import { computeBufferBytes, computeRatio, floatBytesToBigInt } from "@/lib/data-transforms"
import { adapterFetch } from "./adapter-fetch"
import type {
  AnimeBytesPlatformMeta,
  DebugApiCall,
  FetchOptions,
  TrackerAdapter,
  TrackerStats,
} from "./types"

interface AnimeBytesPersonalStats {
  success: boolean
  error?: string
  freeleech?: number
  yen?: { per_day?: number; per_hour?: number; current?: number }
  hnrs?: { potential?: number; active?: number }
  upload?: { raw?: number; account?: number }
  download?: { raw?: number; account?: number }
  torrents?: { uploaded?: number; pruned?: number }
  tracker?: {
    seeding?: number
    leeching?: number
    snatched?: number
    seed_size?: number
    avg_seed_time?: number
  }
  class?: string
}

export function unwrapPersonalStats(
  body: AnimeBytesPersonalStats,
  hostname: string
): AnimeBytesPersonalStats {
  if (!body?.success) {
    throw new Error(body?.error?.trim() || `AnimeBytes API request failed on ${hostname}`)
  }
  return body
}

function bearer(apiToken: string): Record<string, string> {
  return { Authorization: `Bearer ${apiToken}` }
}

export class AnimeBytesAdapter implements TrackerAdapter {
  async fetchStats(
    baseUrl: string,
    apiToken: string,
    apiPath: string,
    options?: FetchOptions
  ): Promise<TrackerStats> {
    const hostname = new URL(baseUrl).hostname
    const url = new URL(apiPath, baseUrl).toString()

    const body = await adapterFetch<AnimeBytesPersonalStats>(
      url,
      hostname,
      options,
      bearer(apiToken)
    )
    const data = unwrapPersonalStats(body, hostname)

    const uploadedBytes = floatBytesToBigInt(data.upload?.account)
    const downloadedBytes = floatBytesToBigInt(data.download?.account)

    const platformMeta: AnimeBytesPlatformMeta = {
      potentialHnrs: data.hnrs?.potential ?? 0,
      yenPerHour: data.yen?.per_hour ?? 0,
      yenPerDay: data.yen?.per_day ?? 0,
      rawUploadedBytes: data.upload?.raw ?? 0,
      rawDownloadedBytes: data.download?.raw ?? 0,
      snatched: data.tracker?.snatched ?? 0,
      seedSizeBytes: data.tracker?.seed_size ?? 0,
      torrentsUploaded: data.torrents?.uploaded ?? 0,
      torrentsPruned: data.torrents?.pruned ?? 0,
    }
    if (typeof data.tracker?.avg_seed_time === "number") {
      platformMeta.avgSeedTime = data.tracker.avg_seed_time
    }
    if (typeof data.freeleech === "number" && data.freeleech > 0) {
      platformMeta.freeleechUntil = data.freeleech
    }

    return {
      username: "",
      group: data.class ?? "",
      uploadedBytes,
      downloadedBytes,
      ratio: computeRatio(uploadedBytes, downloadedBytes),
      bufferBytes: computeBufferBytes(uploadedBytes, downloadedBytes),
      seedingCount: data.tracker?.seeding ?? null,
      leechingCount: data.tracker?.leeching ?? null,
      seedbonus: data.yen?.current ?? null,
      hitAndRuns: data.hnrs?.active ?? null,
      requiredRatio: null,
      warned: null,
      freeleechTokens: null,
      platformMeta,
    }
  }

  async fetchRaw(
    baseUrl: string,
    apiToken: string,
    apiPath: string,
    options?: FetchOptions
  ): Promise<DebugApiCall[]> {
    const hostname = new URL(baseUrl).hostname
    const url = new URL(apiPath, baseUrl).toString()

    try {
      const data = await adapterFetch<Record<string, unknown>>(
        url,
        hostname,
        options,
        bearer(apiToken)
      )
      return [{ label: "Personal stats", endpoint: apiPath, data, error: null }]
    } catch (err) {
      return [
        {
          label: "Personal stats",
          endpoint: apiPath,
          data: null,
          error: err instanceof Error ? err.message : "Request failed",
        },
      ]
    }
  }
}
