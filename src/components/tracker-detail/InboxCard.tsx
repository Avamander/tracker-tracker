// src/components/tracker-detail/InboxCard.tsx

"use client"

import { useQuery } from "@tanstack/react-query"
import { InboxTrackerSection } from "@/components/inbox/InboxTrackerSection"
import { Card } from "@/components/ui/Card"
import type { InboxTracker, TrackerSummary } from "@/types/api"

export function InboxCard({ tracker }: { tracker: TrackerSummary }) {
  const { data } = useQuery({
    queryKey: ["inbox", tracker.id],
    enabled: tracker.inbox !== null,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/inbox?trackerId=${tracker.id}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      })
      if (!res.ok) throw new Error(`Inbox failed: ${res.status}`)
      return ((await res.json()) as { trackers: InboxTracker[] }).trackers[0] ?? null
    },
  })
  if (!data) return null
  const empty =
    data.messages.length === 0 &&
    data.news.length === 0 &&
    !data.unreadMessages &&
    !data.unreadStaffMessages &&
    !data.unreadNotifications
  if (empty) return null

  return (
    <Card title="Inbox & news" trackerColor={tracker.color}>
      <InboxTrackerSection inbox={data} />
    </Card>
  )
}
