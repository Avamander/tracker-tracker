// src/lib/user-classes.ts
//
// Functions: ladderClasses

import type { TrackerUserClass } from "@/data/tracker-registry"

export function ladderClasses(userClasses: TrackerUserClass[]): TrackerUserClass[] {
  return userClasses.filter((uc) => !uc.offLadder)
}
