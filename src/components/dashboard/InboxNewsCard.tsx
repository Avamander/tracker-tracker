// src/components/dashboard/InboxNewsCard.tsx

"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useEffect, useRef } from "react"
import { InboxTrackerSection } from "@/components/inbox/InboxTrackerSection"
import { SectionToggle } from "@/components/ui/SectionToggle"
import { inboxQueryOptions } from "@/lib/query-options"
import type { InboxTracker, TrackerSummary } from "@/types/api"

interface InboxNewsCardProps {
  trackers: TrackerSummary[]
  expanded: boolean
  onToggleExpanded: () => void
}

const hasContent = (t: InboxTracker) =>
  t.messages.length > 0 ||
  t.news.length > 0 ||
  !!t.unreadMessages ||
  !!t.unreadStaffMessages ||
  !!t.unreadNotifications

const urgency = (t: InboxTracker) =>
  (t.unreadStaffMessages ?? 0) > 0 ? 2 : (t.unreadMessages ?? 0) > 0 ? 1 : 0

export function InboxNewsCard({ trackers, expanded, onToggleExpanded }: InboxNewsCardProps) {
  const { data } = useQuery({
    ...inboxQueryOptions,
    enabled: trackers.some((t) => t.inbox !== null),
  })

  // A poll that checked an inbox moves its checkedAt, which arrives with the
  // tracker list. Refetch the inbox then, rather than on the next visit.
  const queryClient = useQueryClient()
  const lastChecked = trackers.reduce((max, t) => {
    const at = t.inbox?.checkedAt ?? ""
    return at > max ? at : max
  }, "")
  const seenChecked = useRef(lastChecked)
  useEffect(() => {
    if (lastChecked === seenChecked.current) return
    seenChecked.current = lastChecked
    queryClient.invalidateQueries({ queryKey: inboxQueryOptions.queryKey })
  }, [lastChecked, queryClient])
  const entries = (data ?? []).filter(hasContent).sort((a, b) => urgency(b) - urgency(a))
  if (entries.length === 0) return null

  return (
    <div className="flex flex-col gap-4">
      <SectionToggle label="Inbox & News" expanded={expanded} onToggle={onToggleExpanded} />
      {expanded && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {entries.map((inbox) => (
            <div
              key={inbox.trackerId}
              className="flex flex-col gap-3 rounded-nm-md border-l-3 bg-control-bg p-4 nm-inset-sm"
              style={{ borderLeftColor: inbox.color }}
            >
              <Link
                href={`/trackers/${inbox.trackerId}`}
                className="text-sm font-semibold hover:text-primary"
              >
                {inbox.name}
              </Link>
              <InboxTrackerSection inbox={inbox} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
