import "server-only"

export class StorageError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

export function uniqueConstraint(error: unknown) {
  return error instanceof Error && /P2002|Unique constraint/.test(error.message)
}

export async function retryWrite<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation()
    } catch (error) {
      const busy =
        error instanceof Error &&
        /P2034|P2028|SQLITE_BUSY|database is locked|write conflict/.test(
          error.message
        )
      if (!busy) throw error
      if (attempt === 5)
        throw new StorageError(503, "Storage is busy; retry the request")
      await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)))
    }
  }
}
