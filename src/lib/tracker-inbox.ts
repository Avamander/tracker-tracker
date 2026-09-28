// src/lib/tracker-inbox.ts
//
// Functions: recordTrackerInbox, pruneTrackerInbox

import { and, eq, inArray, isNotNull, isNull, lt, notInArray } from "drizzle-orm"
import type { NewsItem, TrackerInbox } from "@/lib/adapters/types"
import { db } from "@/lib/db"
import { trackerMessages, trackerNews, trackers } from "@/lib/db/schema"
import { maskUsername } from "@/lib/privacy"

function toDate(value: string | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Store a poll's inbox: current counts and links on the tracker row, every
 * listed unread message (messages no longer listed are marked read) and news
 * items not seen before. Kinds the site reports as read are dismissed.
 */
export async function recordTrackerInbox(
  trackerId: number,
  inbox: TrackerInbox,
  options: { storeUsernames: boolean; now?: Date }
): Promise<void> {
  const now = options.now ?? new Date()
  const listed = inbox.messages

  await db
    .update(trackers)
    .set({
      unreadMessages: inbox.unreadMessages ?? listed?.filter((m) => !m.staff).length ?? null,
      unreadStaffMessages:
        inbox.unreadStaffMessages ?? listed?.filter((m) => m.staff).length ?? null,
      unreadNotifications: inbox.unreadNotifications,
      inboxCheckedAt: now,
      inboxLinks: inbox.links ?? null,
    })
    .where(eq(trackers.id, trackerId))

  if (listed) {
    for (const message of listed) {
      const values = {
        isStaff: message.staff ?? false,
        subject: message.subject,
        sender: options.storeUsernames ? message.sender : maskUsername(message.sender),
        sentAt: toDate(message.sentAt),
        url: message.url ?? null,
        readAt: null,
      }
      await db
        .insert(trackerMessages)
        .values({ trackerId, remoteId: message.id, firstSeenAt: now, ...values })
        .onConflictDoUpdate({
          target: [trackerMessages.trackerId, trackerMessages.remoteId],
          set: values,
        })
    }

    const unreadIds = listed.map((m) => m.id)
    await db
      .update(trackerMessages)
      .set({ readAt: now })
      .where(
        and(
          eq(trackerMessages.trackerId, trackerId),
          isNull(trackerMessages.readAt),
          unreadIds.length > 0 ? notInArray(trackerMessages.remoteId, unreadIds) : undefined
        )
      )
  }

  const seen = inbox.newsSeenOnSite ?? {}
  for (const item of inbox.news ?? []) {
    await db
      .insert(trackerNews)
      .values({
        trackerId,
        remoteId: item.id,
        kind: item.kind,
        title: item.title,
        url: item.url ?? null,
        publishedAt: toDate(item.publishedAt),
        firstSeenAt: now,
        dismissedAt: seen[item.kind] ? now : null,
      })
      .onConflictDoNothing({
        target: [trackerNews.trackerId, trackerNews.kind, trackerNews.remoteId],
      })
  }

  const seenKinds = (Object.keys(seen) as NewsItem["kind"][]).filter((kind) => seen[kind])
  if (seenKinds.length > 0) {
    await db
      .update(trackerNews)
      .set({ dismissedAt: now })
      .where(
        and(
          eq(trackerNews.trackerId, trackerId),
          isNull(trackerNews.dismissedAt),
          inArray(trackerNews.kind, seenKinds)
        )
      )
  }
}

/** Drop messages read and news dismissed before the retention cutoff. */
export async function pruneTrackerInbox(retentionDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  const messages = await db
    .delete(trackerMessages)
    .where(and(isNotNull(trackerMessages.readAt), lt(trackerMessages.readAt, cutoff)))
    .returning({ id: trackerMessages.id })
  const news = await db
    .delete(trackerNews)
    .where(and(isNotNull(trackerNews.dismissedAt), lt(trackerNews.dismissedAt, cutoff)))
    .returning({ id: trackerNews.id })
  return messages.length + news.length
}
