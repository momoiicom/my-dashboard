import { CardKind } from "@/generated/prisma/browser"

export const cardKinds = Object.values(CardKind)

export const cardKindDetails: Record<CardKind, { label: string; description: string; empty: string; defaultTitle: string }> = {
  blank: { label: "Blank", description: "A clear space for anything you want to track.", empty: "", defaultTitle: "Untitled card" },
  notes: { label: "Notes", description: "A place to collect your thoughts.", empty: "No notes yet", defaultTitle: "Notes" },
  tasks: { label: "Tasks", description: "A space for work to get done.", empty: "No tasks yet", defaultTitle: "Tasks" },
  links: { label: "Links", description: "Keep useful places close.", empty: "No links yet", defaultTitle: "Links" },
}
