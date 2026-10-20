// src/data/trackers/c411.ts

import type { TrackerRegistryEntry } from "@/data/tracker-registry"

export const c411: TrackerRegistryEntry = {
  // -- Identity ---------------------------------------------------------
  slug: "c411",
  name: "C411",
  abbreviation: "C411",
  url: "https://c411.org",
  description:
    "French private general tracker covering movies, TV, books, audio, PC and console games, and adult content. Invite-only.",

  // -- Platform & API ---------------------------------------------------
  platform: "c411",
  apiPath: "/api/user/profile",

  // -- Content ----------------------------------------------------------
  specialty: "General",
  contentCategories: ["Movies", "TV", "Music", "Games", "Apps", "Books", "XXX"],
  language: "French",

  // -- Visual -----------------------------------------------------------
  color: "#e11d48",
  logo: "",

  // -- External Links ---------------------------------------------------
  trackerHubSlug: "",
  statusPageUrl: "",
  bonusName: "Zen",

  // -- Community --------------------------------------------------------
  // Grades rank progress through the chosen class's tree, so they are the ladder. The classes
  // themselves (Tanker, Swarm Keeper, Reuploader, Swarm Reaper, Team Mainstream, Team Niche) are
  // chosen, not earned in order.
  userClasses: [
    { name: "Bronze I", requirements: "Granted on choosing a class" },
    { name: "Bronze II", requirements: "10% of the class progression tree" },
    { name: "Bronze III", requirements: "20% of the class progression tree" },
    { name: "Bronze IV", requirements: "30% of the class progression tree" },
    { name: "Argent I", requirements: "40% of the class progression tree" },
    { name: "Argent II", requirements: "50% of the class progression tree" },
    { name: "Argent III", requirements: "60% of the class progression tree" },
    { name: "Argent IV", requirements: "70% of the class progression tree" },
    { name: "Or I", requirements: "80% of the class progression tree" },
    { name: "Or II", requirements: "85% of the class progression tree" },
    { name: "Or III", requirements: "90% of the class progression tree" },
    { name: "Or 411", requirements: "100% of the class progression tree" },
  ],
  releaseGroups: [],
  bannedGroups: [],
  notableMembers: [],

  // -- Rules ------------------------------------------------------------
  rules: {
    minimumRatio: 0.8,
    seedTimeHours: 0,
    loginIntervalDays: 0,
  },

  // -- Status -----------------------------------------------------------
  warning: false,
  warningNote: "",

  // -- Flags ------------------------------------------------------------
  draft: false,
  supportsTransitPapers: false,
  profileUrlPattern: "",
}
