// src/lib/adapters/html-parse.ts
//
// Functions: normalizeWhitespace, datePrefix, tryParseSiteBytes

import { parseBytes } from "@/lib/parser"

// ---------------------------------------------------------------------------
// Shared text helpers for the scraping adapters. html-fetch.ts gets an
// authenticated page; this reads the strings out of one.
// ---------------------------------------------------------------------------

/**
 * Collapses runs of whitespace to single spaces. JS `\s` matches U+00A0, which
 * is the point: labels carry "Join&nbsp;date", so exact matches need this first.
 */
export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

/** `2026-08-20 19:05:17 (1 week ago)` -> `2026-08-20`. */
export function datePrefix(value: string): string | undefined {
  return value.match(/^(\d{4}-\d{2}-\d{2})/)?.[1]
}

/**
 * `parseBytes` for site-printed totals, returning undefined instead of throwing
 * so one odd cell cannot abort a whole profile parse. The unit is uppercased
 * ("kB" vs parseBytes' case-sensitive table) and grouping commas stripped.
 * Decimal units are an unverified assumption; check against live figures.
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
