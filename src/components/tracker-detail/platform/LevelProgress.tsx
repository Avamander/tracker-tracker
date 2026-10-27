// src/components/tracker-detail/platform/LevelProgress.tsx

import { ProgressBar } from "@/components/ui/ProgressBar"
import { formatCount } from "@/lib/formatters"

export interface LevelProgressProps {
  /** What is held now, like "Level 37" */
  current: string
  /** What comes next, or null at the top */
  next: string | null
  into: number
  /** The whole step from current to next */
  need: number
  /** "XP", "quests" */
  unit: string
  accentColor: string
}

/** Progress through one step of a tracker's own progression, laid out like GGn's achievements. */
export function LevelProgress({
  current,
  next,
  into,
  need,
  unit,
  accentColor,
}: LevelProgressProps) {
  const pct = need > 0 ? Math.min(100, (into / need) * 100) : 100
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs font-mono">
        <span className="text-secondary font-semibold">{current}</span>
        <span className="text-tertiary">
          {formatCount(into)} / {formatCount(need)} {unit}
        </span>
        {next && <span className="text-muted">{next}</span>}
      </div>
      <ProgressBar percent={pct} color={accentColor} size="sm" />
      {next && (
        <p className="timestamp text-right">
          {formatCount(Math.max(0, need - into))} {unit} to {next}
        </p>
      )}
    </div>
  )
}
