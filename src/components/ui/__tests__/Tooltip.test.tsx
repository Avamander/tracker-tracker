// src/components/ui/__tests__/Tooltip.test.tsx

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { Tooltip } from "@/components/ui/Tooltip"

const RECT = { top: 100, bottom: 120, left: 40, right: 76, width: 36, height: 20 }

function renderWithRect(side?: "bottom" | "right") {
  const { container } = render(
    <Tooltip content="Explained" side={side}>
      <span>trigger</span>
    </Tooltip>
  )
  const trigger = container.querySelector("span")
  if (!trigger) throw new Error("trigger not found")
  trigger.getBoundingClientRect = () => ({ ...RECT, x: RECT.left, y: RECT.top, toJSON: () => RECT })
  return trigger
}

describe("Tooltip side", () => {
  it("opens under the trigger by default", async () => {
    const user = userEvent.setup()
    await user.hover(renderWithRect())
    const tip = screen.getByRole("tooltip")
    expect(tip.style.top).toBe("126px")
    expect(tip.style.left).toBe("40px")
  })

  it("opens beside the trigger when side is right", async () => {
    const user = userEvent.setup()
    await user.hover(renderWithRect("right"))
    const tip = screen.getByRole("tooltip")
    expect(tip.style.top).toBe("100px")
    expect(tip.style.left).toBe("82px")
  })
})
