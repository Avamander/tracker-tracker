// src/lib/adapters/gazelle.ts
//
// Functions: GazelleAdapter, GazelleAdapter.fetchStats, GazelleAdapter.fetchRaw,
//            GazelleAdapter.fetchInbox

import {
  computeBufferBytes,
  computeRatio,
  floatBytesToBigInt,
  signedFloatBytesToBigInt,
} from "@/lib/data-transforms"
import { adapterFetch } from "./adapter-fetch"
import type {
  DebugApiCall,
  FetchOptions,
  GazellePlatformMeta,
  InboxMessage,
  NewsItem,
  TrackerAdapter,
  TrackerInbox,
  TrackerStats,
} from "./types"

type GazelleNotifications = NonNullable<
  NonNullable<GazelleIndexResponse["response"]>["notifications"]
>

interface GazelleInboxResponse {
  status: string
  response?: {
    messages?: {
      convId: number
      subject: string
      unread: boolean
      username?: string
      date?: string
    }[]
  }
}

interface GazelleAnnouncementsResponse {
  status: string
  response?: {
    announcements?: { newsId: number; title: string; newsTime?: string }[]
    blogPosts?: { blogId: number; title: string; blogTime?: string }[]
  }
}

const pause = () => new Promise((r) => setTimeout(r, 1500))

interface GazelleUserStats {
  uploaded: number
  downloaded: number
  ratio: number
  requiredratio?: number
  class: string
  bonusPoints?: number
  bonuspoints?: number
  seedingcount?: number
  leechingcount?: number
  freeleechTokens?: number
}

interface GazelleIndexResponse {
  status: string
  error?: string
  response?: {
    username: string
    id: number
    giftTokens?: number
    meritTokens?: number
    notifications?: {
      messages: number
      notifications: number
      newAnnouncement: boolean
      newBlog: boolean
      newSubscriptions?: boolean
    }
    userstats: GazelleUserStats
  }
}

interface GazelleUserResponse {
  status: string
  error?: string
  response?: {
    username: string
    avatar: string
    stats: {
      joinedDate: string
      lastAccess: string
      uploaded: number
      downloaded: number
      ratio: number
      buffer: number
      requiredRatio: number
    }
    ranks: {
      uploaded: number
      downloaded: number
      uploads: number
      requests: number
      bounty: number
      posts: number
      artists: number
      overall: number
    }
    personal: {
      class: string
      paranoia: number
      paranoiaText: string
      donor: boolean
      warned: boolean
      enabled: boolean
    }
    community: {
      posts: number
      torrentComments: number
      artistComments?: number
      collageComments?: number
      requestComments?: number
      collagesStarted: number
      collagesContrib: number
      requestsFilled: number
      requestsVoted: number
      perfectFlacs: number
      uploaded: number
      groups: number
      seeding: number
      leeching: number
      snatched: number
      invited: number
      bountyEarned: number | null
      bountySpent: number | null
    }
  }
}

export class GazelleAdapter implements TrackerAdapter {
  async fetchStats(
    baseUrl: string,
    apiToken: string,
    apiPath: string,
    options?: FetchOptions
  ): Promise<TrackerStats> {
    const url = new URL(apiPath, baseUrl)
    url.searchParams.set("action", "index")

    const hostname = new URL(baseUrl).hostname
    const authHeader = options?.authStyle === "raw" ? apiToken : `token ${apiToken}`

    const data = await adapterFetch<GazelleIndexResponse>(url.toString(), hostname, options, {
      Authorization: authHeader,
    })

    if (data.status !== "success") {
      throw new Error(data.error ?? `Gazelle API returned status: ${data.status}`)
    }

    const response = data.response
    if (!response) {
      throw new Error(`Unexpected response from ${hostname}: missing response`)
    }

    const userStats = response.userstats
    if (!userStats) {
      throw new Error(`Unexpected response from ${hostname}: missing userstats`)
    }

    const uploaded = floatBytesToBigInt(userStats.uploaded)
    const downloaded = floatBytesToBigInt(userStats.downloaded)

    const stats: TrackerStats = {
      username: response.username,
      group: userStats.class ?? "Unknown",
      uploadedBytes: uploaded,
      downloadedBytes: downloaded,
      // Derived from byte totals. Gazelle reports -1 for infinite ratio.
      ratio: computeRatio(uploaded, downloaded),
      bufferBytes: computeBufferBytes(uploaded, downloaded),
      seedingCount: userStats.seedingcount ?? 0,
      leechingCount: userStats.leechingcount ?? 0,
      seedbonus: userStats.bonusPoints ?? userStats.bonuspoints ?? null,
      hitAndRuns: null,
      requiredRatio: typeof userStats.requiredratio === "number" ? userStats.requiredratio : null,
      warned: null,
      freeleechTokens:
        typeof userStats.freeleechTokens === "number"
          ? userStats.freeleechTokens
          : typeof response.giftTokens === "number"
            ? response.giftTokens
            : null,
    }

    // Cache the remote user ID from the index response
    if (response.id) {
      stats.remoteUserId = response.id
    }

    // Enrichment: fetch full user profile for ranks, community, warned, etc.
    if (options?.enrich) {
      const userId = options.remoteUserId ?? response.id
      if (userId) {
        try {
          // Brief pause between API calls to avoid rate-limiting on strict Gazelle sites
          await new Promise((r) => setTimeout(r, 1500))
          const enriched = await this.fetchUserProfile(
            baseUrl,
            apiPath,
            authHeader,
            userId,
            hostname,
            options
          )
          if (enriched) {
            // Override core stats with richer data from user profile
            if (typeof enriched.warned === "boolean") stats.warned = enriched.warned
            if (enriched.joinedDate) stats.joinedDate = enriched.joinedDate
            if (enriched.lastAccessDate) stats.lastAccessDate = enriched.lastAccessDate
            if (enriched.bufferBytes != null) stats.bufferBytes = enriched.bufferBytes
            if (typeof enriched.seedingCount === "number")
              stats.seedingCount = enriched.seedingCount
            if (typeof enriched.leechingCount === "number")
              stats.leechingCount = enriched.leechingCount
            if (enriched.avatarUrl) stats.avatarUrl = enriched.avatarUrl
            stats.platformMeta = enriched.platformMeta
          }
        } catch (err) {
          // security-audit-ignore: enrichment failure is non-fatal and core stats from index are still valid
          console.warn(
            `[${hostname}] Enrichment failed: ${err instanceof Error ? err.message : "unknown"}`
          )
        }
      }
    }

    // Merge index-level data (notifications, tokens) into platformMeta
    if (response.notifications || response.giftTokens != null || response.meritTokens != null) {
      const meta = (stats.platformMeta as GazellePlatformMeta) ?? {}
      if (response.notifications) meta.notifications = response.notifications
      if (typeof response.giftTokens === "number") meta.giftTokens = response.giftTokens
      if (typeof response.meritTokens === "number") meta.meritTokens = response.meritTokens
      stats.platformMeta = meta
    }

    if (response.notifications) {
      stats.inbox = await this.fetchInbox(
        baseUrl,
        apiPath,
        authHeader,
        hostname,
        response.notifications,
        options
      )
    }

    return stats
  }

  /** Counts from the index, plus the unread messages and new news when there are any. */
  private async fetchInbox(
    baseUrl: string,
    apiPath: string,
    authHeader: string,
    hostname: string,
    notifications: GazelleNotifications,
    options?: FetchOptions
  ): Promise<TrackerInbox> {
    const site = (path: string) => new URL(path, baseUrl).toString()
    const inbox: TrackerInbox = {
      unreadMessages: notifications.messages,
      unreadStaffMessages: null,
      unreadNotifications: notifications.notifications,
      newsSeenOnSite: {
        announcement: !notifications.newAnnouncement,
        blog: !notifications.newBlog,
      },
      links: { inbox: site("/inbox.php"), news: site("/index.php") },
    }
    const ajax = (params: Record<string, string>) => {
      const url = new URL(apiPath, baseUrl)
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
      return url.toString()
    }

    if (notifications.messages > 0) {
      try {
        await pause()
        const data = await adapterFetch<GazelleInboxResponse>(
          ajax({ action: "inbox", type: "inbox" }),
          hostname,
          options,
          { Authorization: authHeader }
        )
        inbox.messages = (data.response?.messages ?? [])
          .filter((m) => m.unread)
          .map((m): InboxMessage => ({
            id: String(m.convId),
            subject: m.subject,
            sender: m.username ?? null,
            sentAt: m.date,
            url: site(`/inbox.php?action=viewconv&id=${m.convId}`),
          }))
      } catch {}
    }

    if (notifications.newAnnouncement || notifications.newBlog) {
      try {
        await pause()
        const data = await adapterFetch<GazelleAnnouncementsResponse>(
          ajax({ action: "announcements" }),
          hostname,
          options,
          { Authorization: authHeader }
        )
        const news: NewsItem[] = []
        const announcement = data.response?.announcements?.[0]
        if (notifications.newAnnouncement && announcement) {
          news.push({
            id: String(announcement.newsId),
            kind: "announcement",
            title: announcement.title,
            publishedAt: announcement.newsTime,
            url: site("/index.php"),
          })
        }
        const post = data.response?.blogPosts?.[0]
        if (notifications.newBlog && post) {
          news.push({
            id: String(post.blogId),
            kind: "blog",
            title: post.title,
            publishedAt: post.blogTime,
            url: site("/blog.php"),
          })
        }
        inbox.news = news
      } catch {}
    }

    return inbox
  }

  async fetchRaw(
    baseUrl: string,
    apiToken: string,
    apiPath: string,
    options?: FetchOptions
  ): Promise<DebugApiCall[]> {
    const hostname = new URL(baseUrl).hostname
    const authHeader = options?.authStyle === "raw" ? apiToken : `token ${apiToken}`
    const calls: DebugApiCall[] = []

    // Call 1: Index
    const indexUrl = new URL(apiPath, baseUrl)
    indexUrl.searchParams.set("action", "index")
    let indexData: Record<string, unknown> | null = null

    try {
      indexData = await adapterFetch<Record<string, unknown>>(
        indexUrl.toString(),
        hostname,
        options,
        { Authorization: authHeader }
      )
      calls.push({
        label: "Index",
        endpoint: `${apiPath}?action=index`,
        data: indexData,
        error: null,
      })
    } catch (err) {
      calls.push({
        label: "Index",
        endpoint: `${apiPath}?action=index`,
        data: null,
        error: err instanceof Error ? err.message : "Request failed",
      })
      return calls
    }

    // Call 2: User Profile (enrichment)
    const indexResponse = indexData?.response as { id?: number } | undefined
    const userId = options?.remoteUserId ?? indexResponse?.id
    if (userId) {
      const userUrl = new URL(apiPath, baseUrl)
      userUrl.searchParams.set("action", "user")
      userUrl.searchParams.set("id", String(userId))
      const endpoint = `${apiPath}?action=user&id=${userId}`

      try {
        const userData = await adapterFetch<Record<string, unknown>>(
          userUrl.toString(),
          hostname,
          options,
          { Authorization: authHeader }
        )
        calls.push({ label: "User Profile", endpoint, data: userData, error: null })
      } catch (err) {
        calls.push({
          label: "User Profile",
          endpoint,
          data: null,
          error: err instanceof Error ? err.message : "Request failed",
        })
      }
    }

    return calls
  }

  private async fetchUserProfile(
    baseUrl: string,
    apiPath: string,
    authHeader: string,
    userId: number,
    hostname: string,
    options?: FetchOptions
  ): Promise<{
    warned: boolean
    joinedDate?: string
    lastAccessDate?: string
    bufferBytes?: bigint
    seedingCount?: number
    leechingCount?: number
    avatarUrl?: string
    platformMeta: GazellePlatformMeta
  } | null> {
    const userUrl = new URL(apiPath, baseUrl)
    userUrl.searchParams.set("action", "user")
    userUrl.searchParams.set("id", String(userId))

    const data = await adapterFetch<GazelleUserResponse>(userUrl.toString(), hostname, options, {
      Authorization: authHeader,
    })

    if (data.status !== "success" || !data.response) return null

    const resp = data.response
    const meta: GazellePlatformMeta = {
      donor: resp.personal?.donor,
      enabled: resp.personal?.enabled,
      paranoia: resp.personal?.paranoia,
      paranoiaText: resp.personal?.paranoiaText,
    }

    if (resp.ranks) {
      meta.ranks = {
        uploaded: resp.ranks.uploaded,
        downloaded: resp.ranks.downloaded,
        uploads: resp.ranks.uploads,
        requests: resp.ranks.requests,
        bounty: resp.ranks.bounty,
        posts: resp.ranks.posts,
        artists: resp.ranks.artists,
        overall: resp.ranks.overall,
      }
    }

    if (resp.community) {
      meta.community = {
        posts: resp.community.posts,
        torrentComments: resp.community.torrentComments,
        artistComments: resp.community.artistComments ?? 0,
        collageComments: resp.community.collageComments ?? 0,
        requestComments: resp.community.requestComments ?? 0,
        collagesStarted: resp.community.collagesStarted,
        collagesContrib: resp.community.collagesContrib,
        requestsFilled: resp.community.requestsFilled,
        requestsVoted: resp.community.requestsVoted,
        perfectFlacs: resp.community.perfectFlacs,
        uploaded: resp.community.uploaded,
        groups: resp.community.groups,
        snatched: resp.community.snatched,
        invited: resp.community.invited,
        bountyEarned: resp.community.bountyEarned ?? null,
        bountySpent: resp.community.bountySpent ?? null,
      }
    }

    return {
      warned: resp.personal?.warned ?? false,
      joinedDate: resp.stats?.joinedDate ?? undefined,
      lastAccessDate: resp.stats?.lastAccess ?? undefined,
      // Gazelle's buffer value is signed. It overwrites the derived value in
      // fetchStats. If clamped here, enriched Gazelle sites would report 0 for
      // a deficit despite what the helpers compute.
      bufferBytes:
        resp.stats?.buffer != null ? signedFloatBytesToBigInt(resp.stats.buffer) : undefined,
      seedingCount: resp.community?.seeding,
      leechingCount: resp.community?.leeching,
      avatarUrl: resp.avatar || undefined,
      platformMeta: meta,
    }
  }
}
