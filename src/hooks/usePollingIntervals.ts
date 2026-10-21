// src/hooks/usePollingIntervals.ts

"use client"

import { useQuery } from "@tanstack/react-query"
import { clientQueryOptions } from "@/lib/query-options"
import type { SafeDownloadClient, TrackerSummary } from "@/types/api"

interface PollingIntervals {
  /** Tracker + dashboard refetch interval in ms (from trackerPollIntervalMinutes) */
  trackerRefetchMs: number
  /** Client snapshot refetch interval in ms (from minimum pollIntervalSeconds across clients) */
  clientRefetchMs: number
}

const DEFAULT_TRACKER_MS = 60_000
const DEFAULT_CLIENT_MS = 5 * 60 * 1000

export function selectMinPollInterval(clients: SafeDownloadClient[]): number | null {
  const enabled = clients.filter((c) => c.enabled)
  if (enabled.length === 0) return null
  return Math.min(...enabled.map((c) => c.pollIntervalSeconds))
}

// The scheduler checks for due trackers every five minutes, so a cycle can land
// that long after it falls due, plus the time the polls take.
const CYCLE_GRACE_MS = 30_000
const CYCLE_RECHECK_MS = 60_000

/**
 * How long to wait before fetching the tracker list again: until just after
 * the next poll cycle falls due, then each minute until it lands, so a poll's
 * results reach the sidebar within a minute rather than up to an interval
 * late. A list whose newest poll is long past, such as one with every
 * tracker paused, falls back to the plain interval.
 */
export function trackerRefetchDelay(
  trackers: TrackerSummary[] | undefined,
  intervalMs: number,
  now = Date.now()
): number {
  let newest = 0
  for (const t of trackers ?? []) {
    const at = t.lastPolledAt ? Date.parse(t.lastPolledAt) : Number.NaN
    if (at > newest) newest = at
  }
  if (newest === 0 || now - newest > 2 * intervalMs) return intervalMs
  const untilDue = newest + intervalMs + CYCLE_GRACE_MS - now
  return Math.min(intervalMs, Math.max(CYCLE_RECHECK_MS, untilDue))
}

// Reads poll intervals from app settings and client config

export function usePollingIntervals(): PollingIntervals {
  const { data: settingsData } = useQuery({
    queryKey: ["polling-intervals"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/settings", { signal })
      if (!res.ok) return null
      const settings = await res.json()
      return {
        trackerPollIntervalMinutes: settings.trackerPollIntervalMinutes as number | undefined,
      }
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  })

  const { data: clientsData } = useQuery({
    ...clientQueryOptions,
    select: selectMinPollInterval,
  })

  const trackerRefetchMs = settingsData?.trackerPollIntervalMinutes
    ? settingsData.trackerPollIntervalMinutes * 60 * 1000
    : DEFAULT_TRACKER_MS

  const clientRefetchMs = clientsData ? clientsData * 1000 : DEFAULT_CLIENT_MS

  return { trackerRefetchMs, clientRefetchMs }
}
