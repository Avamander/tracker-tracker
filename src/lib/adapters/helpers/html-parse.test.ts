// src/lib/adapters/helpers/html-parse.test.ts
//
// tryParseSiteBytes returns undefined rather than throwing, so a unit it fails
// to recognise reads as "the tracker does not report this" instead of raising.
// That makes a gap in the unit table silent, which is what these cases pin.

import { describe, expect, it } from "vitest"
import { parseBytes } from "@/lib/parser"
import { datePrefix, normalizeWhitespace, tryParseSiteBytes } from "./html-parse"

describe("tryParseSiteBytes", () => {
  it("parses the decimal units, whatever case the site prints", () => {
    expect(tryParseSiteBytes("1 GB")).toBe(parseBytes("1 GB"))
    expect(tryParseSiteBytes("5 kB")).toBe(parseBytes("5 KB"))
    expect(tryParseSiteBytes("2 tb")).toBe(parseBytes("2 TB"))
  })

  it("parses the IEC binary units, which a blanket uppercase silently dropped", () => {
    expect(tryParseSiteBytes("1 KiB")).toBe(parseBytes("1 KiB"))
    expect(tryParseSiteBytes("1 MiB")).toBe(parseBytes("1 MiB"))
    expect(tryParseSiteBytes("1 GiB")).toBe(parseBytes("1 GiB"))
    expect(tryParseSiteBytes("1 TiB")).toBe(parseBytes("1 TiB"))
    expect(tryParseSiteBytes("3 gib")).toBe(parseBytes("3 GiB"))
  })

  it("keeps binary and decimal units distinct rather than collapsing them", () => {
    expect(tryParseSiteBytes("1 GiB")).toBe(1073741824n)
    expect(tryParseSiteBytes("1 GB")).toBe(1000000000n)
  })

  it("strips grouping commas, which parseBytes rejects outright", () => {
    expect(tryParseSiteBytes("1,234.5 GB")).toBe(parseBytes("1234.5 GB"))
    expect(() => parseBytes("1,234.5 GB")).toThrow()
  })

  it("returns undefined for a unit that is not a byte unit at all", () => {
    expect(tryParseSiteBytes("12 posts")).toBeUndefined()
    expect(tryParseSiteBytes("1 XB")).toBeUndefined()
    expect(tryParseSiteBytes("")).toBeUndefined()
    expect(tryParseSiteBytes("N/A")).toBeUndefined()
  })
})

describe("normalizeWhitespace", () => {
  it("collapses the non-breaking space that labels arrive with", () => {
    expect(normalizeWhitespace("Join date")).toBe("Join date")
    expect(normalizeWhitespace("  a \n\t b  ")).toBe("a b")
  })
})

describe("datePrefix", () => {
  it("keeps the date and drops the time and the relative suffix", () => {
    expect(datePrefix("2026-08-20 19:05:17 (1 week ago)")).toBe("2026-08-20")
  })

  it("returns undefined when the value does not start with a date", () => {
    expect(datePrefix("never")).toBeUndefined()
    expect(datePrefix("20-08-2026")).toBeUndefined()
  })
})
