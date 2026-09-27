// src/data/trackers/torrentleech.ts

import type { TrackerRegistryEntry } from "@/data/tracker-registry"

export const torrentleech: TrackerRegistryEntry = {
  // ── Identity ────────────────────────────────────────────────────────
  slug: "torrentleech",
  name: "TorrentLeech",
  abbreviation: "TL",
  url: "https://www.torrentleech.org",
  description:
    "Large general tracker known for having open signups very often. Broad content library across most categories.",

  // ── Platform & API ──────────────────────────────────────────────────
  platform: "torrentleech",
  apiPath: "/profile",

  // ── Content ─────────────────────────────────────────────────────────
  specialty: "General",
  contentCategories: ["Movies", "TV", "Games", "Music", "Apps", "Books"],
  language: "English",

  // ── Visual ──────────────────────────────────────────────────────────
  color: "#2ecc71",
  logo: "/tracker-logos/torrentleech_logo.png",

  // ── External Links ──────────────────────────────────────────────────
  trackerHubSlug: "torrent-leech",
  statusPageUrl: "",
  bonusName: "TL Points",

  // ── Community ───────────────────────────────────────────────────────
  userClasses: [
    {
      name: "Registered",
      requirements: "Default class for new members",
      perks: [{ type: "custom", label: "10-day minimum seed time" }],
    },
    {
      name: "Power User",
      requirements: "2 weeks, 200 GB up, ratio above 1.1. Demoted below the ratio",
      perks: [{ type: "custom", label: "+3% points, 8-day minimum seed time" }],
    },
    {
      name: "Super User",
      requirements: "12 weeks, 1 TB up, ratio above 2.0. Demoted below the ratio",
      perks: [{ type: "custom", label: "+5% points, 7-day minimum seed time" }],
    },
    {
      name: "Extreme User",
      requirements: "24 weeks, 10 TB up, ratio above 5.0. Demoted below the ratio",
      perks: [{ type: "custom", label: "+6% points, 6-day minimum seed time" }],
    },
    {
      name: "TL GOD",
      requirements: "52 weeks, 50 TB up, ratio above 8.0. Demoted below the ratio",
      perks: [{ type: "custom", label: "+8% points, 4-day minimum seed time" }],
    },
    {
      name: "VIP",
      requirements: "Given to donors, or assigned by staff",
      perks: [{ type: "custom", label: "+10% points, no minimum seed time" }],
      offLadder: true,
    },
    {
      name: "Uploader",
      requirements: "Appointed by the Uploader Group Leader",
      perks: [{ type: "upload", label: "Upload torrents" }],
      offLadder: true,
    },
    {
      name: "FLS",
      requirements: "Appointed by the FLS Group Leader",
      offLadder: true,
    },
    {
      name: "Moderator",
      requirements: "Staff: keeps torrents tidy, bans cheaters. Appointed",
      offLadder: true,
    },
    {
      name: "Group Leader",
      requirements: "Staff: appointed by Administrators",
      offLadder: true,
    },
    {
      name: "Administrator",
      requirements: "Staff: oversees all staff and runs the site",
      offLadder: true,
    },
    {
      name: "Super Administrator",
      requirements: "Site owner or coder",
      offLadder: true,
    },
  ],
  releaseGroups: [],
  bannedGroups: [],
  notableMembers: [],

  // ── Rules ───────────────────────────────────────────────────────────
  rules: {
    // Both routes, verbatim from wiki.torrentleech.org/doku.php/hnr: "There are
    // two ways for you to give back to the community" — seed a torrent to at
    // least 1:1, OR seed it for the minimum time required for your user class.
    // Hence `any`. FreeLeech is explicitly NOT exempt from either.
    minimumRatio: 1.0,
    // 10 days, the Registered-class requirement and the longest one on the
    // site (Power User 8d, Super User 7d, Extreme User 6d, TL GOD 4d, VIP
    // none). Deliberately the longest: the class is not knowable from the
    // registry, and over-seeding is the safe direction to be wrong in.
    seedTimeHours: 240,
    satisfactionMode: "any",
    loginIntervalDays: 120,
  },

  // ── Status ──────────────────────────────────────────────────────────
  warning: false,
  warningNote: "",

  // ── Flags ───────────────────────────────────────────────────────────
  draft: false,
  supportsTransitPapers: false,
  profileUrlPattern: "/profile/{username}",
}
