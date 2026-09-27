// src/data/trackers/iptorrents.ts

import type { TrackerRegistryEntry } from "@/data/tracker-registry"

export const iptorrents: TrackerRegistryEntry = {
  // ── Identity ────────────────────────────────────────────────────────
  slug: "iptorrents",
  name: "IPTorrents",
  abbreviation: "IPT",
  url: "https://iptorrents.com",
  description:
    "General tracker with a controversial reputation. Extremely large userbase. Content quality can be inconsistent.",

  // ── Platform & API ──────────────────────────────────────────────────
  platform: "iptorrents",
  apiPath: "/profile",

  // ── Content ─────────────────────────────────────────────────────────
  specialty: "General",
  contentCategories: ["Movies", "TV", "Games", "Music", "Apps", "Books"],
  language: "English",

  // ── Visual ──────────────────────────────────────────────────────────
  color: "#e74c3c",
  logo: "",

  // ── External Links ──────────────────────────────────────────────────
  trackerHubSlug: "",
  statusPageUrl: "",
  announceHosts: ["bgp.technology"],

  // ── Community ───────────────────────────────────────────────────────
  userClasses: [
    {
      name: "Peasant",
      requirements:
        "Ratio below 0.30 with over 1 GB downloaded for 1 week. Warned to correct the ratio",
      perks: [{ type: "custom", label: "Seeding only" }],
    },
    {
      name: "User",
      requirements: "Default class for new members",
    },
    {
      name: "Power User",
      requirements: "4 weeks, 50 GB up, ratio ≥ 1.05. Automatic; demoted if ratio drops below 0.95",
      perks: [
        { type: "custom", label: "Make requests, view the Top 10" },
        { type: "custom", label: "Apply for Uploader" },
      ],
    },
    {
      name: "Star",
      requirements: "Any donation other than a FreeLeech donation",
      perks: [
        { type: "hnr-immune", label: "Immune to automatic demotion and H&R warnings" },
        { type: "custom", label: "H&R warnings cleared on donation. Seeding still required" },
      ],
      offLadder: true,
    },
    {
      name: "VIP",
      requirements: "Assigned to the best of the best, or given on donation. Begging disqualifies",
      perks: [
        { type: "custom", label: "Power User privileges, Elite Member of IPT" },
        { type: "hnr-immune", label: "Immune to H&R warnings during VIP; cleared on donation" },
      ],
      offLadder: true,
    },
    {
      name: "Uploader",
      requirements: "Appointed by staff (see the Uploading section)",
      perks: [
        { type: "upload", label: "Upload rights" },
        { type: "custom", label: "Immune to automatic demotion" },
        { type: "custom", label: "More forums, peer lists on non-anonymous torrents" },
      ],
      offLadder: true,
    },
    {
      name: "TCM/TDE",
      requirements: "Appointed by staff. Do not ask",
      perks: [{ type: "custom", label: "Staff: edit comments (TCM) or torrents (TDE)" }],
      offLadder: true,
    },
    {
      name: "Moderator",
      requirements: "Appointed by staff",
      perks: [
        { type: "custom", label: "Edit and delete torrents, moderate comments, disable accounts" },
      ],
      offLadder: true,
    },
    {
      name: "Administrator",
      requirements: "Staff",
      perks: [{ type: "custom", label: "Can do just about anything" }],
      offLadder: true,
    },
    {
      name: "IPT Gods",
      requirements: "Staff leaders",
      offLadder: true,
    },
  ],
  releaseGroups: [],
  bannedGroups: [],
  notableMembers: [],

  // ── Rules ───────────────────────────────────────────────────────────
  rules: {
    minimumRatio: 1.0,
    seedTimeHours: 336,
    loginIntervalDays: 90,
  },

  // ── Status ──────────────────────────────────────────────────────────
  warning: false,
  warningNote: "",

  // ── Flags ───────────────────────────────────────────────────────────
  draft: false,
  supportsTransitPapers: false,
  profileUrlPattern: "/u/{id}",
}
