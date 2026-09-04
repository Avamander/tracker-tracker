// src/lib/rank-ladder.ts
//
// Functions: findClassIndex, buildRankLadder

import type { TrackerUserClass } from "@/data/tracker-registry"
import { isRedacted } from "@/lib/privacy"

export interface RankRung {
  name: string
  requirements?: string
}

export interface RankLadder {
  /** Earned classes only, lowest first. */
  rungs: RankRung[]
  /** Position in `rungs`, or -1 when the current class is unknown or redacted. */
  currentIndex: number
  /**
   * Set when the member holds a class above the ladder (staff, donor). There
   * is no rung for it, so the stack renders fully lit under this name.
   */
  appointedClass: string | null
}

/**
 * Trackers report the class name as free text and registry names are the
 * canonical casing, so the match is case-insensitive. A redacted name is a
 * privacy mask, not a class, and never matches.
 */
export function findClassIndex(
  classes: TrackerUserClass[],
  className: string | null | undefined
): number {
  if (!className || isRedacted(className)) return -1
  const wanted = className.toLowerCase()
  return classes.findIndex((c) => c.name.toLowerCase() === wanted)
}

export function buildRankLadder(
  classes: TrackerUserClass[],
  currentClass: string | null | undefined
): RankLadder | null {
  const rungs = classes
    .filter((c) => !c.outsideLadder)
    .map((c) => ({ name: c.name, requirements: c.requirements }))
  if (rungs.length === 0) return null

  const index = findClassIndex(classes, currentClass)
  if (index === -1) return { rungs, currentIndex: -1, appointedClass: null }

  const current = classes[index]
  if (current.outsideLadder === "above") {
    return { rungs, currentIndex: rungs.length - 1, appointedClass: current.name }
  }
  // A demotion or administrative state has no rung either, but nothing has
  // been earned, so it renders empty under the class name the caller shows.
  if (current.outsideLadder === "below") return { rungs, currentIndex: -1, appointedClass: null }
  return { rungs, currentIndex: findClassIndex(rungs, current.name), appointedClass: null }
}
