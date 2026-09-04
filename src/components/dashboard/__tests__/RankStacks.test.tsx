// src/components/dashboard/__tests__/RankStacks.test.tsx
//
// The Ranks section draws one equal-height stack per tracker that has an
// earned class ladder in the registry. These pin the rules that decide which
// trackers appear, how many rungs each stack has, and how many are lit.

import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TrackerRegistryEntry, TrackerUserClass } from "@/data/tracker-registry"
import type { TrackerLatestStats, TrackerSummary } from "@/types/api"

const push = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

const LADDERS: Record<string, TrackerUserClass[]> = {
  "https://alpha.example": [
    { name: "Leech", requirements: "Ratio below 0.4", outsideLadder: "below" },
    { name: "User", requirements: "Ratio at or above 0.4" },
    { name: "Power User", requirements: "1 TiB uploaded" },
    { name: "VIP", requirements: "Donation", outsideLadder: "above" },
  ],
  "https://beta.example": [],
  "https://gamma.example": [
    { name: "User", requirements: "Default" },
    { name: "Elite", requirements: "5 TiB uploaded" },
  ],
}

vi.mock("@/data/tracker-registry", () => ({
  findRegistryEntry: (baseUrl: string) =>
    baseUrl in LADDERS
      ? ({ userClasses: LADDERS[baseUrl] } as unknown as TrackerRegistryEntry)
      : undefined,
}))

import { RankStacks } from "@/components/dashboard/RankStacks"

const baseStats: TrackerLatestStats = {
  ratio: 1,
  ratioIsInfinite: false,
  uploadedBytes: "0",
  downloadedBytes: "0",
  bufferBytes: null,
  seedingCount: null,
  leechingCount: null,
  requiredRatio: null,
  warned: null,
  freeleechTokens: null,
  hitAndRuns: null,
  seedbonus: null,
  shareScore: null,
  username: null,
  group: null,
}

function makeTracker(
  id: number,
  name: string,
  baseUrl: string,
  group: string | null,
  overrides: Partial<TrackerSummary> = {}
): TrackerSummary {
  return {
    id,
    name,
    baseUrl,
    platformType: "unit3d",
    isActive: true,
    lastPolledAt: null,
    lastError: null,
    lastErrorAt: null,
    consecutiveFailures: 0,
    pausedAt: null,
    userPausedAt: null,
    color: "#00d4ff",
    qbtTag: null,
    mouseholeUrl: null,
    useProxy: false,
    countCrossSeedUnsatisfied: false,
    hideUnreadBadges: false,
    isFavorite: false,
    sortOrder: null,
    joinedAt: null,
    lastAccessAt: null,
    remoteUserId: null,
    platformMeta: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    latestStats: { ...baseStats, group },
    ...overrides,
  }
}

const alpha = makeTracker(1, "Alpha", "https://alpha.example", "power user")
const beta = makeTracker(2, "Beta", "https://beta.example", "Member")
const gamma = makeTracker(3, "Gamma", "https://gamma.example", null)

function stackFor(name: string): HTMLElement {
  const stack = screen.getByRole("button", { name: new RegExp(`^${name}`) })
  return stack
}

function rungs(stack: HTMLElement): HTMLElement[] {
  return Array.from(stack.querySelectorAll<HTMLElement>("[data-rung]"))
}

function litCount(stack: HTMLElement): number {
  return rungs(stack).filter((r) => r.dataset.lit === "true").length
}

beforeEach(() => {
  push.mockReset()
})

describe("RankStacks", () => {
  it("shows one stack per tracker with a ladder and skips the rest", () => {
    render(<RankStacks trackers={[alpha, beta, gamma]} expanded onToggleExpanded={() => {}} />)
    expect(screen.getByText("Ranks")).toBeInTheDocument()
    expect(stackFor("Alpha")).toBeInTheDocument()
    expect(stackFor("Gamma")).toBeInTheDocument()
    expect(screen.queryByText("Beta")).not.toBeInTheDocument()
  })

  it("draws only the earned rungs and lights them up to the current class", () => {
    render(<RankStacks trackers={[alpha, gamma]} expanded onToggleExpanded={() => {}} />)
    const a = stackFor("Alpha")
    // Leech sits below the ladder and VIP above it, so the rungs are User and Power User.
    expect(rungs(a)).toHaveLength(2)
    expect(litCount(a)).toBe(2)
    expect(within(a).getByText("Power User")).toBeInTheDocument()

    const g = stackFor("Gamma")
    expect(rungs(g)).toHaveLength(2)
    expect(litCount(g)).toBe(0)
    expect(within(g).getByText("—")).toBeInTheDocument()
  })

  it("speaks the class and rank in each stack's accessible name", () => {
    const vip = makeTracker(5, "Epsilon", "https://alpha.example", "VIP")
    const demoted = makeTracker(7, "Theta", "https://alpha.example", "Leech")
    render(
      <RankStacks trackers={[alpha, gamma, vip, demoted]} expanded onToggleExpanded={() => {}} />
    )
    expect(stackFor("Alpha")).toHaveAttribute("aria-label", "Alpha: Power User, rank 2 of 2")
    expect(stackFor("Gamma")).toHaveAttribute("aria-label", "Gamma: unknown class, rank 0 of 2")
    expect(stackFor("Epsilon")).toHaveAttribute(
      "aria-label",
      "Epsilon: VIP, above the 2-rank ladder"
    )
    expect(stackFor("Theta")).toHaveAttribute("aria-label", "Theta: Leech, rank 0 of 2")
  })

  it("lights a partial stack for a mid-ladder class", () => {
    const user = makeTracker(4, "Delta", "https://alpha.example", "User")
    render(<RankStacks trackers={[user]} expanded onToggleExpanded={() => {}} />)
    const d = stackFor("Delta")
    expect(litCount(d)).toBe(1)
    const lit = rungs(d).map((r) => r.dataset.lit)
    // Rungs are listed bottom-up: the lowest is lit, the top is ghosted.
    expect(lit).toEqual(["true", "false"])
  })

  it("renders a class above the ladder as a full stack under its own name", () => {
    const vip = makeTracker(5, "Epsilon", "https://alpha.example", "VIP")
    render(<RankStacks trackers={[vip]} expanded onToggleExpanded={() => {}} />)
    const e = stackFor("Epsilon")
    expect(rungs(e)).toHaveLength(2)
    expect(litCount(e)).toBe(2)
    expect(within(e).getByText("VIP")).toBeInTheDocument()
  })

  it("renders a demoted member as an empty stack under the demotion class", () => {
    const demoted = makeTracker(7, "Theta", "https://alpha.example", "Leech")
    render(<RankStacks trackers={[demoted]} expanded onToggleExpanded={() => {}} />)
    const t = stackFor("Theta")
    expect(rungs(t)).toHaveLength(2)
    expect(litCount(t)).toBe(0)
    expect(within(t).getByText("Leech")).toBeInTheDocument()
  })

  it("renders nothing at all when no active tracker has a ladder", () => {
    const archived = makeTracker(6, "Zeta", "https://alpha.example", "User", { isActive: false })
    const { container } = render(
      <RankStacks trackers={[beta, archived]} expanded onToggleExpanded={() => {}} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("keeps the toggle but hides the stacks when collapsed", () => {
    render(<RankStacks trackers={[alpha]} expanded={false} onToggleExpanded={() => {}} />)
    expect(screen.getByText("Ranks")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Alpha/ })).not.toBeInTheDocument()
  })

  it("opens the tracker page when a stack is clicked", () => {
    render(<RankStacks trackers={[alpha]} expanded onToggleExpanded={() => {}} />)
    fireEvent.click(stackFor("Alpha"))
    expect(push).toHaveBeenCalledWith("/trackers/1")
  })

  it("explains a rung on hover with its class name and requirements", async () => {
    const user = userEvent.setup()
    render(<RankStacks trackers={[alpha]} expanded onToggleExpanded={() => {}} />)
    const top = rungs(stackFor("Alpha"))[1]
    await user.hover(top)
    const tip = screen.getByRole("tooltip")
    expect(tip.textContent).toContain("Power User")
    expect(tip.textContent).toContain("1 TiB uploaded")
  })
})
