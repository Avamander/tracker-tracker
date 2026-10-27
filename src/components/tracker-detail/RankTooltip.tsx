// src/components/tracker-detail/RankTooltip.tsx
"use client"

import { SlotLabel } from "@typography"
import clsx from "clsx"
import { Badge } from "@/components/ui/Badge"
import { Tooltip } from "@/components/ui/Tooltip"
import type { TrackerUserClass } from "@/data/tracker-registry"
import { hexToRgba } from "@/lib/color-utils"
import { type ClassLevelParser, findClassIndex, OUTSIDE_LADDER_NOTE } from "@/lib/rank-ladder"

interface RankTooltipProps {
  currentRank: string
  userClasses: TrackerUserClass[]
  /** Maps a class carrying a level onto its rank, from the registry entry */
  classLevel?: ClassLevelParser
  accentColor: string
}

export function RankTooltip({
  currentRank,
  userClasses,
  classLevel,
  accentColor,
}: RankTooltipProps) {
  const currentIndex = findClassIndex(userClasses, currentRank, classLevel)
  return (
    <Tooltip
      content={
        <div className="min-w-50">
          <SlotLabel label="Ranks" className="px-3 pb-1.5" />
          {userClasses.map((uc, i) => {
            const isCurrent = i === currentIndex
            return (
              <div
                key={uc.name}
                className={clsx(
                  "px-3 py-1.5 text-xs font-mono flex items-center justify-between gap-2",
                  uc.outsideLadder && "opacity-60"
                )}
                title={uc.outsideLadder ? OUTSIDE_LADDER_NOTE[uc.outsideLadder] : undefined}
                style={
                  isCurrent
                    ? { color: accentColor, backgroundColor: hexToRgba(accentColor, 0.1) }
                    : undefined
                }
              >
                <span className={isCurrent ? "font-semibold" : "text-secondary"}>{uc.name}</span>
                {isCurrent && <span className="text-3xs">&larr; you</span>}
              </div>
            )
          })}
        </div>
      }
    >
      <Badge
        tabIndex={0}
        style={{
          backgroundColor: hexToRgba(accentColor, 0.15),
          color: accentColor,
        }}
      >
        <span className="flex items-center gap-2">
          {currentRank}
          <span className="help-icon opacity-70" aria-hidden="true">
            ?
          </span>
        </span>
      </Badge>
    </Tooltip>
  )
}
