import { getToken } from "next-auth/jwt"
import { NextResponse, type NextRequest } from "next/server"

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname

  if (
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

  return NextResponse.redirect(new URL("/login", request.url))
}

export const config = {
  matcher: ["/:path*"],
}
