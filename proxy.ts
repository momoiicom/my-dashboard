import { workspaceCallbackUrl } from "@/lib/board"
import { getToken } from "next-auth/jwt"
import { NextResponse, type NextRequest } from "next/server"
import { localUiMode } from "@/lib/local-ui-mode"

export async function proxy(request: NextRequest) {
  if (localUiMode()) return NextResponse.next()
  const path = request.nextUrl.pathname

  if (
    path === "/api/bot/capabilities" ||
    path === "/api/bot/boards" ||
    /^\/api\/bot\/cards\/[^/]+$/.test(path) ||
    path === "/login" ||
    path === "/api/auth" ||
    path.startsWith("/api/auth/") ||
    path.startsWith("/_next/static/") ||
    path === "/_next/image" ||
    path === "/favicon.ico"
  )
    return NextResponse.next()

  const secret = process.env.NEXTAUTH_SECRET
  const token =
    secret && process.env.DATABASE_URL
      ? await getToken({ req: request, secret })
      : null
  if (token) return NextResponse.next()

  if (path.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const login = new URL("/login", request.url)
  login.searchParams.set("callbackUrl", workspaceCallbackUrl(path))
  return NextResponse.redirect(login)
}

export const config = {
  matcher: ["/:path*"],
}
