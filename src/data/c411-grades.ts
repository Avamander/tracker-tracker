// src/data/c411-grades.ts
//
// Functions: c411ClassLevel
//
// C411's grades are four steps in each of Bronze, Silver and Gold, named as
// the adapter reports them ("Bronze II", "Gold 411"). The ladder lists the
// three tiers.

import type { ClassLevel, TrackerUserClass } from "@/data/tracker-registry"

const TIERS = ["Bronze", "Silver", "Gold"] as const
const STEPS = ["I", "II", "III", "IV"] as const

export const C411_USER_CLASSES: TrackerUserClass[] = [
  { name: "Bronze", requirements: "Starting grade" },
  { name: "Silver" },
  { name: "Gold" },
]

/**
 * Reads "Silver III" as the third of Silver's four grades. A grade counts as
 * earned, so the fourth fills its tier. Gold's fourth grade is Gold 411.
 */
export function c411ClassLevel(className: string): ClassLevel | null {
  const [tier, step, ...rest] = className.trim().split(/\s+/)
  if (rest.length > 0) return null
  const t = TIERS.findIndex((name) => name.toLowerCase() === tier?.toLowerCase())
  if (t === -1 || step === undefined) return null
  const s = t === 2 && step === "411" ? 3 : STEPS.indexOf(step as (typeof STEPS)[number])
  if (s === -1 || (t === 2 && step === "IV")) return null
  return { rank: TIERS[t], level: t * 4 + s + 1, fraction: (s + 1) / 4 }
}
