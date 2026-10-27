// src/data/c411-levels.ts
//
// Functions: c411LevelName, c411LevelStep
//
// C411's account level, earned with XP, unlocks site features. It is a second
// ladder beside the grade, with a rung at each level that unlocks something.

import type { ClassLevel, RankPerk, TrackerUserClass } from "@/data/tracker-registry"

// What each level unlocks, translated from the site's list.
const RUNGS: readonly [number, string[]][] = [
  [1, []],
  [
    4,
    [
      "Comment on torrents",
      "Write in chat channels",
      "Open private conversations",
      "React to forum messages",
    ],
  ],
  [7, ["Reply on the forum", "Vote on a torrent's trust", "Vote on community playlists"]],
  [10, ["Comment on news", "Report forum messages"]],
  [
    15,
    [
      "Upload releases in contributors mode",
      "Tag forum topics",
      "Read restricted forum categories",
      "Start forum topics",
      "Vote on torrent requests",
      "Vote on proposals",
    ],
  ],
  [
    25,
    [
      "Apply to the Team Pending",
      "Create torrent requests",
      "Create proposals",
      "Exempt from the limited slow mode",
    ],
  ],
]

export function c411LevelName(level: unknown): string | null {
  if (typeof level !== "number" || !Number.isInteger(level) || level < 1) return null
  return `Level ${level}`
}

/** A rung's name: the range of levels it covers, like "Level 4–6" or "Level 25+". */
function rungName(index: number): string {
  const start = RUNGS[index][0]
  const next = RUNGS[index + 1]?.[0]
  if (next === undefined) return `Level ${start}+`
  return next - 1 === start ? `Level ${start}` : `Level ${start}–${next - 1}`
}

export const C411_LEVEL_CLASSES: TrackerUserClass[] = RUNGS.map(([level, labels], i) => ({
  name: rungName(i),
  ...(level === 1 ? { requirements: "Starting level" } : {}),
  ...(labels.length > 0
    ? { perks: labels.map((label): RankPerk => ({ type: "custom", label })) }
    : {}),
}))

/**
 * Reads "Level 12" as part of the Level 10–14 rung, two fifths of the way to
 * Level 15 by level count, since C411 publishes no XP curve. The last rung has
 * no end, so it is full.
 */
export function c411LevelStep(className: string): ClassLevel | null {
  const match = /^Level (\d+)$/i.exec(className.trim())
  if (!match) return null
  const level = Number(match[1])
  if (level < 1) return null
  const index = RUNGS.findLastIndex(([at]) => level >= at)
  const start = RUNGS[index][0]
  const next = RUNGS[index + 1]?.[0]
  return {
    rank: rungName(index),
    level,
    fraction: next === undefined ? 1 : (level - start) / (next - start),
  }
}
