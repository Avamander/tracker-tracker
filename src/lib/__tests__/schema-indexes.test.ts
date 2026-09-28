// src/lib/__tests__/schema-indexes.test.ts
//
// Functions: (test file)

import { getTableConfig } from "drizzle-orm/pg-core"
import { describe, expect, it } from "vitest"
import {
  appCoverageGaps,
  clientSnapshots,
  trackerMessages,
  trackerNews,
  trackerRoles,
  trackerSnapshots,
} from "@/lib/db/schema"

describe("schema indexes", () => {
  it("trackerSnapshots has composite index on (trackerId, polledAt)", () => {
    const config = getTableConfig(trackerSnapshots)
    const idx = config.indexes.find((i) => i.config.name === "idx_snapshots_tracker_polled")
    expect(idx).toBeDefined()
  })

  it("trackerSnapshots has BRIN index on polledAt", () => {
    const config = getTableConfig(trackerSnapshots)
    const idx = config.indexes.find((i) => i.config.name === "idx_snapshots_polled_brin")
    expect(idx).toBeDefined()
  })

  it("clientSnapshots has composite index on (clientId, polledAt)", () => {
    const config = getTableConfig(clientSnapshots)
    const idx = config.indexes.find((i) => i.config.name === "idx_client_snapshots_client_polled")
    expect(idx).toBeDefined()
  })

  it("appCoverageGaps has an index on startedAt for the overlap query", () => {
    const config = getTableConfig(appCoverageGaps)
    const idx = config.indexes.find((i) => i.config.name === "idx_app_coverage_gaps_started")
    expect(idx).toBeDefined()
  })

  it("appCoverageGaps has an index on endedAt — the retention prune keys on it", () => {
    const config = getTableConfig(appCoverageGaps)
    const idx = config.indexes.find((i) => i.config.name === "idx_app_coverage_gaps_ended")
    expect(idx).toBeDefined()
  })

  it("trackerRoles has index on trackerId", () => {
    const config = getTableConfig(trackerRoles)
    const idx = config.indexes.find((i) => i.config.name === "idx_tracker_roles_tracker_id")
    expect(idx).toBeDefined()
  })

  it("trackerMessages is unique per tracker message and indexed for unread lookups", () => {
    const names = getTableConfig(trackerMessages).indexes.map((i) => i.config.name)
    expect(names).toContain("uq_tracker_messages_remote")
    expect(names).toContain("idx_tracker_messages_tracker_read")
  })

  it("trackerNews is unique per tracker, kind and item, and indexed for undismissed lookups", () => {
    const config = getTableConfig(trackerNews)
    const unique = config.indexes.find((i) => i.config.name === "uq_tracker_news_remote")
    expect(unique?.config.columns.map((c) => ("name" in c ? c.name : ""))).toEqual([
      "tracker_id",
      "kind",
      "remote_id",
    ])
    expect(config.indexes.map((i) => i.config.name)).toContain("idx_tracker_news_tracker_dismissed")
  })
})
