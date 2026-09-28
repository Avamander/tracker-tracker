// src/hooks/useDismissNews.ts

import { useMutation, useQueryClient } from "@tanstack/react-query"

export function useDismissNews() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: { ids?: number[]; trackerId?: number }) => {
      const res = await fetch("/api/inbox/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`Dismiss failed: ${res.status}`)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox"] })
      queryClient.invalidateQueries({ queryKey: ["trackers"] })
    },
  })
}
