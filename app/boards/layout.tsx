import { getServerSession } from "next-auth"
import { authOptions, localUiUser } from "@/lib/auth"
import { getWorkspaceSnapshot } from "@/lib/board-store"
import { localUiMode } from "@/lib/local-ui-mode"
import { BoardWorkspace } from "@/components/board-workspace"

export default async function BoardsLayout({ children }: { children: React.ReactNode }) {
  const localUser = await localUiUser()
  const session = localUser ? { user: localUser } : await getServerSession(authOptions)
  if (!session?.user?.id) return children
  const workspace = await getWorkspaceSnapshot(session.user.id)
  return <BoardWorkspace initialWorkspace={workspace} name={session.user.name || "Your account"} image={session.user.image} localUiMode={localUiMode()}>{children}</BoardWorkspace>
}
