"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
import type { BotConnection } from "@/lib/bot-connection"

export function ConnectBotDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [connection, setConnection] = useState<BotConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    fetch("/api/bot/connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            `Connection setup failed (${response.status}). Please retry.`
          )
        return response.json() as Promise<BotConnection>
      })
      .then((value) => {
        if (!controller.signal.aborted) setConnection(value)
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Connection setup failed. Please retry."
          )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [open, retry])

  function retrySetup() {
    setConnection(null)
    setLoading(true)
    setError("")
    setCopied(false)
    setRevealed(false)
    setRetry((value) => value + 1)
  }

  async function copy() {
    if (!connection) return
    try {
      await navigator.clipboard.writeText(connection.instructions)
      setCopied(true)
    } catch {
      setError(
        "Automatic copy is unavailable. Select and copy the instructions below."
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bot-connect-dialog">
        <DialogHeader>
          <DialogTitle>Connect your bot</DialogTitle>
          <DialogDescription>
            Give your bot this instruction bundle. It can create and update
            cards; you control their place on the board.
          </DialogDescription>
        </DialogHeader>
        {loading && (
          <p role="status" className="bot-connect-state">
            Preparing your connection…
          </p>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {error && !connection && (
          <Button variant="outline" onClick={retrySetup} disabled={loading}>
            Retry connection setup
          </Button>
        )}
        {connection && (
          <>
            <div className="bot-connection-summary">
              <span>
                Endpoint <strong>{connection.baseUrl}</strong>
              </span>
              <span>
                Owner token{" "}
                <strong>
                  {revealed
                    ? connection.token
                    : `••••••••${connection.token.slice(-6)}`}
                </strong>{" "}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRevealed(!revealed)}
                  aria-label={
                    revealed ? "Hide owner token" : "Reveal owner token"
                  }
                >
                  {revealed ? "Hide" : "Reveal"}
                </Button>
              </span>
            </div>
            {connection.localOnly && (
              <p className="bot-local-note">
                This address is local to this machine. A remote bot needs a
                reachable address before it can connect.
              </p>
            )}
            <label
              htmlFor="bot-instructions"
              className="bot-instructions-label"
            >
              Bot instructions
            </label>
            <Textarea
              id="bot-instructions"
              className="bot-instructions"
              value={connection.instructions}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
              aria-label="Bot instructions"
            />
            <p className="bot-copy-hint">
              Select the text above to copy it manually if clipboard access is
              unavailable.
            </p>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={() => void copy()} disabled={!connection || loading}>
            {copied ? "Copied" : "Copy instructions"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
