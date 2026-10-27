// src/data/trackers/c411.ts

import { C411_USER_CLASSES, c411ClassLevel } from "@/data/c411-grades"
import { C411_LEVEL_CLASSES, c411LevelName, c411LevelStep } from "@/data/c411-levels"
import type { TrackerRegistryEntry } from "@/data/tracker-registry"
import type { C411PlatformMeta } from "@/types/tracker-stats"

export const c411: TrackerRegistryEntry = {
  // ── Identity ────────────────────────────────────────────────────────
  slug: "c411",
  name: "C411",
  abbreviation: "C411",
  url: "https://c411.org",
  description:
    "French private general tracker covering movies, TV, books, audio, PC and console games, and adult content. Invite-only.",

  // ── Platform & API ──────────────────────────────────────────────────
  platform: "c411",
  apiPath: "/api/user/profile",

  // ── Content ─────────────────────────────────────────────────────────
  specialty: "General",
  contentCategories: ["Movies", "TV", "Music", "Games", "Apps", "Books", "XXX"],
  language: "French",

  // ── Visual ──────────────────────────────────────────────────────────
  color: "#e11d48",
  logo: "/tracker-logos/c411_logo.png",
  bonusName: "Zen",

  // ── External Links ──────────────────────────────────────────────────
  trackerHubSlug: "",
  statusPageUrl: "",

  // ── Community ───────────────────────────────────────────────────────
  // The rank is the class-tree grade; c411ClassLevel places each grade
  // ("Bronze II") in its tier. The account level, which unlocks site features,
  // is a second ladder beside it.
  userClasses: C411_USER_CLASSES,
  classLevel: c411ClassLevel,
  secondaryLadder: {
    label: "Level",
    userClasses: C411_LEVEL_CLASSES,
    classLevel: c411LevelStep,
    currentClass: (meta) => c411LevelName((meta as C411PlatformMeta | null)?.level),
  },
  releaseGroups: [],
  bannedGroups: [],
  notableMembers: [],

  // ── Rules ───────────────────────────────────────────────────────────
  // Only the ratio gates downloads. C411's 72-hour H&R rule is switched off,
  // per its wiki, so no seed time is required today.
  rules: {
    minimumRatio: 0.8,
    seedTimeHours: 0,
    loginIntervalDays: 0,
  },

  // ── Status ──────────────────────────────────────────────────────────
  warning: false,
  warningNote: "",

  // ── Flags ───────────────────────────────────────────────────────────
  draft: false,
  supportsTransitPapers: false,
  profileUrlPattern: "",
}
