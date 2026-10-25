// src/lib/prowlarr/sync.ts
//
// Functions: decryptInstanceKey, testProwlarrInstance, pollProwlarrInstance,
//            loadTrackerProwlarrStates, listIndexerOptions
//
// Reads each Prowlarr instance into prowlarr_indexers and turns those rows into
// the per-tracker state on TrackerSummary. A failed poll is recorded on the
// instance and never on a tracker. Polls go through requestProwlarrPoll in
// prowlarr-scheduler.ts, so two polls of one instance never overlap.

import "server-only"

import { and, eq, inArray, notInArray, sql } from "drizzle-orm"
import { decrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import { prowlarrIndexers, prowlarrInstances } from "@/lib/db/schema"
import { errMsg, isDecryptionError } from "@/lib/error-utils"
import { PROWLARR_INDEXER_REFRESH_MS, PROWLARR_STALE_MS } from "@/lib/limits"
import { log } from "@/lib/logger"
import {
  fetchIndexerStatuses,
  fetchIndexers,
  fetchSystemStatus,
  type ProwlarrConnection,
  sanitizeProwlarrError,
} from "@/lib/prowlarr/client"
import { type MatchableTracker, matchTrackerIndexers } from "@/lib/prowlarr/matching"
import type {
  ProwlarrIndexerOption,
  TrackerProwlarrIndexer,
  TrackerProwlarrState,
} from "@/types/api"

type KeyedInstance = { url: string; encryptedApiKey: string | null }

/** A problem with the stored settings, already worded for the UI. */
class ProwlarrSetupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProwlarrSetupError"
  }
}

function describeFailure(err: unknown): string {
  if (err instanceof ProwlarrSetupError) return err.message
  if (isDecryptionError(err)) return "Stored API key could not be decrypted"
  return sanitizeProwlarrError(errMsg(err))
}

/** Decryption errors are thrown as they are, so a request route can answer them with a 401. */
export function decryptInstanceKey(instance: KeyedInstance, key: Buffer): ProwlarrConnection {
  if (!instance.encryptedApiKey) {
    throw new ProwlarrSetupError("No API key stored. Enter the Prowlarr API key")
  }
  return { url: instance.url, apiKey: decrypt(instance.encryptedApiKey, key) }
}

/** One cheap request, for the settings page's Test Connection button. */
export async function testProwlarrInstance(
  instance: KeyedInstance,
  key: Buffer
): Promise<{ version: string | null } | { error: string }> {
  const conn = decryptInstanceKey(instance, key)
  try {
    return await fetchSystemStatus(conn)
  } catch (err) {
    return { error: describeFailure(err) }
  }
}

/**
 * Reads the indexer status of one instance, plus the indexer list when it is
 * due or `readIndexers` is set. All reads finish before any write, so a poll
 * with a failed request changes only the instance's error.
 */
export async function pollProwlarrInstance(
  instanceId: number,
  key: Buffer,
  options: { readIndexers?: boolean } = {}
): Promise<void> {
  const [instance] = await db
    .select({
      id: prowlarrInstances.id,
      url: prowlarrInstances.url,
      encryptedApiKey: prowlarrInstances.encryptedApiKey,
      enabled: prowlarrInstances.enabled,
      lastError: prowlarrInstances.lastError,
      indexersReadAt: prowlarrInstances.indexersReadAt,
    })
    .from(prowlarrInstances)
    .where(eq(prowlarrInstances.id, instanceId))
    .limit(1)
  if (!instance?.enabled) return

  const now = new Date()
  const readIndexers =
    options.readIndexers === true ||
    !instance.indexersReadAt ||
    now.getTime() - instance.indexersReadAt.getTime() >= PROWLARR_INDEXER_REFRESH_MS

  try {
    const conn = decryptInstanceKey(instance, key)
    const [indexers, statuses, version] = await Promise.all([
      readIndexers ? fetchIndexers(conn) : null,
      fetchIndexerStatuses(conn),
      // Only shown in settings, so a failure here does not fail the poll.
      readIndexers
        ? fetchSystemStatus(conn).then(
            (s) => s.version,
            () => undefined
          )
        : undefined,
    ])
    const statusById = new Map(statuses.map((s) => [s.indexerId, s]))
    const failureFields = (indexerId: number) => {
      const failure = statusById.get(indexerId)
      return {
        disabledTill: failure?.disabledTill ?? null,
        mostRecentFailure: failure?.mostRecentFailure ?? null,
        initialFailure: failure?.initialFailure ?? null,
        checkedAt: now,
      }
    }

    await db.transaction(async (tx) => {
      if (indexers) {
        const ids = indexers.map((i) => i.indexerId)
        await tx
          .delete(prowlarrIndexers)
          .where(
            ids.length > 0
              ? and(
                  eq(prowlarrIndexers.instanceId, instanceId),
                  notInArray(prowlarrIndexers.indexerId, ids)
                )
              : eq(prowlarrIndexers.instanceId, instanceId)
          )
        for (const indexer of indexers) {
          const values = {
            name: indexer.name,
            enabled: indexer.enabled,
            hosts: indexer.hosts,
            ...failureFields(indexer.indexerId),
          }
          await tx
            .insert(prowlarrIndexers)
            .values({ instanceId, indexerId: indexer.indexerId, ...values })
            .onConflictDoUpdate({
              target: [prowlarrIndexers.instanceId, prowlarrIndexers.indexerId],
              set: values,
            })
        }
      } else {
        // An indexer added in Prowlarr since the last list read has no row yet,
        // so its status is skipped until the next one.
        await tx
          .update(prowlarrIndexers)
          .set(failureFields(0))
          .where(eq(prowlarrIndexers.instanceId, instanceId))
        for (const status of statuses) {
          await tx
            .update(prowlarrIndexers)
            .set(failureFields(status.indexerId))
            .where(
              and(
                eq(prowlarrIndexers.instanceId, instanceId),
                eq(prowlarrIndexers.indexerId, status.indexerId)
              )
            )
        }
      }
      await tx
        .update(prowlarrInstances)
        .set({
          lastPolledAt: now,
          lastError: null,
          errorSince: null,
          ...(readIndexers ? { indexersReadAt: now } : {}),
          ...(version !== undefined ? { version: version?.slice(0, 50) ?? null } : {}),
        })
        .where(eq(prowlarrInstances.id, instanceId))
    })

    if (instance.lastError) log.info({ prowlarrInstanceId: instanceId }, "Prowlarr poll recovered")
  } catch (err) {
    const raw = errMsg(err)
    const message = describeFailure(err)
    // Logged on a change of cause only. The raw cause names the host at most,
    // never the URL path or the key.
    if (message !== instance.lastError) {
      log.warn({ prowlarrInstanceId: instanceId, cause: raw }, `Prowlarr poll failed: ${message}`)
    }
    try {
      await db
        .update(prowlarrInstances)
        .set({
          lastError: message,
          errorSince: sql`COALESCE(${prowlarrInstances.errorSince}, NOW())`,
        })
        .where(eq(prowlarrInstances.id, instanceId))
    } catch (dbErr) {
      log.error(
        { prowlarrInstanceId: instanceId, error: errMsg(dbErr) },
        "Failed to record Prowlarr poll error"
      )
    }
  }
}

interface StoredIndexer extends TrackerProwlarrIndexer {
  hosts: string[]
}

async function loadStoredIndexers(): Promise<StoredIndexer[]> {
  const instances = await db
    .select({
      id: prowlarrInstances.id,
      name: prowlarrInstances.name,
      url: prowlarrInstances.url,
      lastError: prowlarrInstances.lastError,
    })
    .from(prowlarrInstances)
    .where(eq(prowlarrInstances.enabled, true))
  if (instances.length === 0) return []

  const byId = new Map(instances.map((i) => [i.id, i]))
  const staleBefore = Date.now() - PROWLARR_STALE_MS
  const rows = await db
    .select({
      instanceId: prowlarrIndexers.instanceId,
      indexerId: prowlarrIndexers.indexerId,
      name: prowlarrIndexers.name,
      enabled: prowlarrIndexers.enabled,
      hosts: prowlarrIndexers.hosts,
      disabledTill: prowlarrIndexers.disabledTill,
      mostRecentFailure: prowlarrIndexers.mostRecentFailure,
      initialFailure: prowlarrIndexers.initialFailure,
      checkedAt: prowlarrIndexers.checkedAt,
    })
    .from(prowlarrIndexers)
    .where(inArray(prowlarrIndexers.instanceId, [...byId.keys()]))
    .orderBy(prowlarrIndexers.instanceId, prowlarrIndexers.name)

  return rows.map((row) => {
    const instance = byId.get(row.instanceId)
    return {
      instanceId: row.instanceId,
      instanceName: instance?.name ?? "",
      instanceUrl: instance?.url ?? "",
      instanceError: instance?.lastError ?? null,
      stale: row.checkedAt.getTime() < staleBefore,
      indexerId: row.indexerId,
      name: row.name,
      enabled: row.enabled,
      hosts: row.hosts ?? [],
      disabledTill: row.disabledTill?.toISOString() ?? null,
      mostRecentFailure: row.mostRecentFailure?.toISOString() ?? null,
      initialFailure: row.initialFailure?.toISOString() ?? null,
      checkedAt: row.checkedAt.toISOString(),
    }
  })
}

/**
 * The matched Prowlarr state for each tracker, keyed by tracker id. Trackers
 * with no match are absent. One query when no instance is enabled.
 */
export async function loadTrackerProwlarrStates(
  trackers: readonly (MatchableTracker & { id: number })[]
): Promise<Map<number, TrackerProwlarrState>> {
  const out = new Map<number, TrackerProwlarrState>()
  const stored = await loadStoredIndexers()
  if (stored.length === 0) return out
  for (const tracker of trackers) {
    const match = matchTrackerIndexers(tracker, stored)
    if (!match) continue
    out.set(tracker.id, {
      matchedBy: match.matchedBy,
      indexers: match.indexers.map(({ hosts: _hosts, ...indexer }) => indexer),
    })
  }
  return out
}

/** Every stored indexer of an enabled instance, for the manual match picker. */
export async function listIndexerOptions(): Promise<ProwlarrIndexerOption[]> {
  const stored = await loadStoredIndexers()
  return stored.map((i) => ({
    instanceId: i.instanceId,
    instanceName: i.instanceName,
    indexerId: i.indexerId,
    name: i.name,
    hosts: i.hosts,
  }))
}
