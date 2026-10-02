import type { CacheConfig, E2EConfig } from "e2e"

export const cache = {
  mode: "read-write",
  dir: ".e2e/cache",
} satisfies CacheConfig

export default {
  targets: [{ name: "cache", platform: "web" }],
  cache,
} satisfies E2EConfig
