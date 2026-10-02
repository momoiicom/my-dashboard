import "server-only"

import { PrismaAdapter } from "@next-auth/prisma-adapter"
import { getServerSession, type NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"

const googleConfigured = Boolean(
  process.env.DATABASE_URL &&
  process.env.NEXTAUTH_SECRET &&
  process.env.GOOGLE_CLIENT_ID &&
  process.env.GOOGLE_CLIENT_SECRET
)

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
  pages: { signIn: "/login" },
  providers: googleConfigured
    ? [
        GoogleProvider({
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        }),
      ]
    : [],
}

export async function requireSession() {
  if (!process.env.NEXTAUTH_SECRET || !process.env.DATABASE_URL)
    redirect("/login")
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  return session
}
