"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { useBoardRegistration } from "@/components/board-workspace"
import type { BoardSnapshot } from "@/lib/board"

export function BoardRouteSnapshot({ snapshot }: { snapshot: BoardSnapshot }) {
  const register = useBoardRegistration()
  const pathname = usePathname()
  useEffect(() => { register(snapshot, pathname) }, [register, snapshot, pathname])
  return null
}
