// src/lib/adapters/html-parse.ts
//
// Functions: normalizeWhitespace, datePrefix, tryParseSiteBytes

import { parseBytes } from "@/lib/parser"

// ---------------------------------------------------------------------------
// Shared text helpers for the scraping adapters.
//
// html-fetch.ts is the seam for GETTING an authenticated page; this is the seam
// for reading the strings out of one. The TBDev-family sites (FileList,
// RetroToon) render the same three idioms, and each adapter previously carried
// its own byte-for-byte copy of these, so a fix to the unit table or the date
// shape had to be made in every one.
// ---------------------------------------------------------------------------

/**
 * Collapses runs of whitespace to single spaces.
 *
 * JS `\s` matches U+00A0, which is the point: these sites write labels with
 * non-breaking spaces ("Join&nbsp;date", "Snatchlist&nbsp;(0)"), so a literal
 * `label === "Join date"` comparison only works after this runs.
 */
export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

/** `2026-08-20 19:05:17 (1 week ago)` -> `2026-08-20`. */
export function datePrefix(value: string): string | undefined {
  return value.match(/^(\d{4}-\d{2}-\d{2})/)?.[1]
}

/**
 * `parseBytes` adapted to how these sites print byte totals, returning
 * undefined instead of throwing so one odd cell cannot abort a whole profile
 * parse.
 *
 * Two adaptations. The sites print "kB" while parseBytes' decimal unit table is
 * case-sensitive (KB/MB/GB/TB), so the unit token is uppercased. And grouping
 * commas are stripped, which parseBytes' own regex rejects.
 *
 * Decimal units are deliberate: site figures are 2-decimal approximations and
 * whether a given site's own math is 1000- or 1024-based is not verifiable from
 * a fresh account, so every scraping adapter here feeds site strings to the
 * decimal table. Revisit against live figures, not in the abstract.
 */
export function tryParseSiteBytes(value: string): bigint | undefined {
  const match = value.trim().match(/^([\d,.]+)\s*([A-Za-z]+)$/)
  if (!match) return undefined
  try {
    return parseBytes(`${match[1].replace(/,/g, "")} ${match[2].toUpperCase()}`)
  } catch {
    return undefined
  }
}
