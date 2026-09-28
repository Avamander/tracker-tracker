// src/components/inbox/InboxTrackerSection.tsx

"use client"

import { ExternalLinkSmallIcon } from "@icons"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { useDismissNews } from "@/hooks/useDismissNews"
import { formatTimeAgo } from "@/lib/formatters"
import type { InboxMessageView, InboxTracker } from "@/types/api"

function ItemLink({ href, children }: { href: string | null | undefined; children: string }) {
  if (!href) return <span className="truncate">{children}</span>
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-w-0 items-center gap-1 truncate hover:text-primary"
    >
      <span className="truncate">{children}</span>
      <ExternalLinkSmallIcon width="9" height="9" className="shrink-0" />
    </a>
  )
}

function MessageRow({ message, fallbackUrl }: { message: InboxMessageView; fallbackUrl?: string }) {
  return (
    <li className="flex items-center gap-2 text-xs">
      {message.isStaff && <Badge variant="danger">Staff</Badge>}
      <span className="min-w-0 flex-1 text-secondary">
        <ItemLink href={message.url ?? fallbackUrl}>{message.subject || "(no subject)"}</ItemLink>
      </span>
      {message.sender && <span className="shrink-0 font-mono text-tertiary">{message.sender}</span>}
      {message.sentAt && (
        <span className="shrink-0 font-mono text-muted">{formatTimeAgo(message.sentAt)}</span>
      )}
    </li>
  )
}

export function InboxTrackerSection({ inbox }: { inbox: InboxTracker }) {
  const dismiss = useDismissNews()
  const staff = inbox.messages.filter((m) => m.isStaff)
  const messages = inbox.messages.filter((m) => !m.isStaff)
  const unlistedStaff = (inbox.unreadStaffMessages ?? 0) - staff.length
  const unlistedMessages = (inbox.unreadMessages ?? 0) - messages.length

  return (
    <div className="flex flex-col gap-3">
      {(staff.length > 0 || unlistedStaff > 0) && (
        <ul className="flex flex-col gap-1.5">
          {staff.map((m) => (
            <MessageRow key={m.id} message={m} fallbackUrl={inbox.links?.staff} />
          ))}
          {unlistedStaff > 0 && (
            <li className="text-xs text-danger">
              <ItemLink href={inbox.links?.staff}>
                {`${unlistedStaff} unread staff message${unlistedStaff === 1 ? "" : "s"}`}
              </ItemLink>
            </li>
          )}
        </ul>
      )}
      {(messages.length > 0 || unlistedMessages > 0) && (
        <ul className="flex flex-col gap-1.5">
          {messages.map((m) => (
            <MessageRow key={m.id} message={m} fallbackUrl={inbox.links?.inbox} />
          ))}
          {unlistedMessages > 0 && (
            <li className="text-xs text-warn">
              <ItemLink href={inbox.links?.inbox}>
                {`${unlistedMessages} unread message${unlistedMessages === 1 ? "" : "s"}`}
              </ItemLink>
            </li>
          )}
        </ul>
      )}
      {(inbox.unreadNotifications ?? 0) > 0 && (
        <p className="text-xs text-secondary">
          {`${inbox.unreadNotifications} unread notification${inbox.unreadNotifications === 1 ? "" : "s"}`}
        </p>
      )}
      {inbox.news.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {inbox.news.map((n) => (
            <li key={n.id} className="flex items-center gap-2 text-xs">
              <Badge variant="accent">{n.kind}</Badge>
              <span className="min-w-0 flex-1 text-secondary">
                <ItemLink href={n.url ?? inbox.links?.news}>{n.title}</ItemLink>
              </span>
              <Button
                variant="minimal"
                size="sm"
                text="Dismiss"
                disabled={dismiss.isPending}
                onClick={() => dismiss.mutate({ ids: [n.id] })}
              />
            </li>
          ))}
          {inbox.news.length > 1 && (
            <li>
              <Button
                variant="minimal"
                size="sm"
                text="Dismiss all news"
                disabled={dismiss.isPending}
                onClick={() => dismiss.mutate({ trackerId: inbox.trackerId })}
              />
            </li>
          )}
        </ul>
      )}
      {inbox.checkedAt && (
        <p className="font-mono text-3xs text-muted">Checked {formatTimeAgo(inbox.checkedAt)}</p>
      )}
    </div>
  )
}
