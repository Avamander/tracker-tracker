// src/components/dashboard/RankStacks.tsx
"use client"

import { useRouter } from "next/navigation"
import { RedactedText } from "@/components/ui/RedactedText"
import { SectionToggle } from "@/components/ui/SectionToggle"
import { Tooltip } from "@/components/ui/Tooltip"
import { findRegistryEntry } from "@/data/tracker-registry"
import { hexToRgba } from "@/lib/color-utils"
import { isRedacted } from "@/lib/privacy"
import { buildRankLadder, type RankLadder } from "@/lib/rank-ladder"
import type { TrackerSummary } from "@/types/api"

interface StackEntry {
  tracker: TrackerSummary
  ladder: RankLadder
}

interface RankStacksProps {
  trackers: TrackerSummary[]
  // Collapse state is owned by the parent's single useSectionCollapse instance,
  // for the same reason LoginTimers does not call the hook itself.
  expanded: boolean
  onToggleExpanded: () => void
}

function RankStack({ tracker, ladder, onOpen }: StackEntry & { onOpen: () => void }) {
  const { rungs, currentIndex, appointedClass } = ladder
  const lit = currentIndex + 1
  // An unknown class name still gets shown under the stack: the tracker said
  // it, the registry just has no rung for it. Redacted names render as blocks.
  const shownClass =
    appointedClass ?? (currentIndex >= 0 ? rungs[currentIndex].name : tracker.latestStats?.group)
  // aria-label replaces the button's content as its accessible name, so the
  // class has to be repeated here or a screen reader never hears it.
  const spokenClass =
    shownClass == null ? "unknown class" : isRedacted(shownClass) ? "class redacted" : shownClass
  const accessibleName = appointedClass
    ? `${tracker.name}: ${appointedClass}, above the ${rungs.length}-rank ladder`
    : `${tracker.name}: ${spokenClass}, rank ${lit} of ${rungs.length}`

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={accessibleName}
      className="flex flex-col items-center gap-2 w-28 px-3 py-3 nm-interactive-sm rounded-nm-md cursor-pointer bg-transparent border-none"
    >
      {/* Every stack is the same height; rung thickness is what varies. DOM
          order is bottom-up so the lowest class is the first child. */}
      <div className="flex flex-col-reverse gap-[2px] h-24 w-9">
        {rungs.map((rung, i) => {
          const isCurrent = i === currentIndex
          const isLit = i < lit
          return (
            <Tooltip
              key={rung.name}
              side="right"
              className="flex-1 min-h-0 flex"
              content={
                <span className="block w-48">
                  <span className="font-semibold text-primary">{rung.name}</span>
                  {rung.requirements && <span className="block mt-0.5">{rung.requirements}</span>}
                </span>
              }
            >
              <span
                data-rung={i}
                data-lit={isLit ? "true" : "false"}
                className="flex-1 rounded-[2px] transition-colors duration-150"
                style={{
                  backgroundColor: isLit
                    ? hexToRgba(tracker.color, isCurrent ? 1 : 0.45)
                    : hexToRgba(tracker.color, 0.1),
                  boxShadow: isCurrent ? `0 0 8px ${hexToRgba(tracker.color, 0.5)}` : undefined,
                }}
              />
            </Tooltip>
          )
        })}
      </div>
      <span className="font-sans text-xs font-semibold text-primary truncate w-full text-center">
        {tracker.name}
      </span>
      <RedactedText
        value={shownClass}
        color={tracker.color}
        className="font-mono text-3xs text-tertiary truncate w-full text-center"
      />
    </button>
  )
}

export function RankStacks({ trackers, expanded, onToggleExpanded }: RankStacksProps) {
  const router = useRouter()

  const entries: StackEntry[] = trackers.flatMap((tracker) => {
    if (!tracker.isActive) return []
    const classes = findRegistryEntry(tracker.baseUrl)?.userClasses ?? []
    const ladder = buildRankLadder(classes, tracker.latestStats?.group)
    return ladder ? [{ tracker, ladder }] : []
  })

  if (entries.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      <SectionToggle label="Ranks" expanded={expanded} onToggle={onToggleExpanded} />

      {expanded && (
        <div className="flex flex-wrap gap-3">
          {entries.map(({ tracker, ladder }) => (
            <RankStack
              key={tracker.id}
              tracker={tracker}
              ladder={ladder}
              onOpen={() => router.push(`/trackers/${tracker.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
