// src/lib/manual-poll.ts
//
// Functions: runManualPoll

import { and, eq, isNull, lte, or } from "drizzle-orm"
import { db } from "@/lib/db"
import { appSettings, trackers } from "@/lib/db/schema"
import { isDecryptionError } from "@/lib/error-utils"
import { POLL_MANUAL_COOLDOWN_MS } from "@/lib/limits"
import { log } from "@/lib/logger"
import { pollTracker } from "@/lib/tracker-scheduler"
import { buildProxyAgentFromSettings } from "@/lib/tunnel"

export type ManualPollResult = { ok: true } | { ok: false; status: number; error: string }

/**
 * Runs a poll the user requested, as Poll Now does: at most one per tracker per
 * cooldown, claimed with an atomic update so that several tabs cannot start
 * overlapping polls. The result is recorded on the tracker as for any poll.
 */
export async function runManualPoll(
  trackerId: number,
  key: Buffer,
  route: string
): Promise<ManualPollResult> {
  // Atomically claim poll slot. Prevents TOCTOU race with multiple tabs
  const threshold = new Date(Date.now() - POLL_MANUAL_COOLDOWN_MS)
  const [claimed] = await db
    .update(trackers)
    .set({ lastPolledAt: new Date() })
    .where(
      and(
        eq(trackers.id, trackerId),
        or(isNull(trackers.lastPolledAt), lte(trackers.lastPolledAt, threshold))
      )
    )
    .returning({ id: trackers.id })

  if (!claimed) {
    return { ok: false, status: 429, error: "Poll cooldown: try again in a few seconds" }
  }

  const [settings] = await db
    .select({
      storeUsernames: appSettings.storeUsernames,
      proxyEnabled: appSettings.proxyEnabled,
      proxyType: appSettings.proxyType,
      proxyHost: appSettings.proxyHost,
      proxyPort: appSettings.proxyPort,
      proxyUsername: appSettings.proxyUsername,
      encryptedProxyPassword: appSettings.encryptedProxyPassword,
    })
    .from(appSettings)
    .limit(1)

  const privacyMode = settings ? !settings.storeUsernames : false
  const proxyAgent = settings ? buildProxyAgentFromSettings(settings, key) : undefined

  try {
    await pollTracker(trackerId, key, privacyMode, proxyAgent, undefined, undefined, true)
    return { ok: true }
  } catch (error) {
    if (isDecryptionError(error)) {
      log.warn({ route, trackerId }, "manual poll failed: stale session key")
      return { ok: false, status: 401, error: "Session expired. Please log in again." }
    }
    log.error({ route, trackerId, error: String(error) }, "manual poll failed")
    return { ok: false, status: 500, error: "Poll failed" }
  }
}
