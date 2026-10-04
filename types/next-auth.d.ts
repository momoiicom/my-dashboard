import "next-auth"

declare module "next-auth" {
  interface Session {
    user?: {
      googleVerified?: boolean
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
    }
  }
}
