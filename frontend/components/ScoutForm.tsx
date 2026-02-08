import { useState, useEffect, type FormEvent } from "react";
import * as chrono from "chrono-node";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface ScoutFormProps {
  query: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (email: string, expiresAt?: string) => Promise<void>;
}

/**
 * Try to extract an end time from the user's query using chrono-node NLP.
 * Returns an ISO string if a time reference is found, null otherwise.
 */
function parseEndTimeFromQuery(query: string): Date | null {
  // chrono parses natural language dates — "today", "tonight", "end of day", "tomorrow", etc.
  const results = chrono.parse(query, new Date(), { forwardDate: true });

  if (results.length === 0) return null;

  // Use the last referenced date (most likely the end boundary)
  const lastResult = results[results.length - 1];

  // If the result has an end date, use it; otherwise use the start
  const endDate = lastResult.end
    ? lastResult.end.date()
    : lastResult.start.date();

  // Only use if in the future
  if (endDate.getTime() <= Date.now()) return null;

  return endDate;
}

/** Format a date nicely for display */
function formatDate(date: Date): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffHrs = Math.round(diffMs / (1000 * 60 * 60));

  const dateStr = date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  if (diffHrs < 24) {
    return `Today at ${timeStr} (~${diffHrs}h from now)`;
  }
  return `${dateStr} at ${timeStr}`;
}

/** Convert a Date to local datetime-local input value */
function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ScoutForm({
  query,
  open,
  onOpenChange,
  onSubmit,
}: ScoutFormProps) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // End time state
  const [nlpDate, setNlpDate] = useState<Date | null>(null);
  const [useNlpDate, setUseNlpDate] = useState(true);
  const [manualDate, setManualDate] = useState("");
  const [showManual, setShowManual] = useState(false);

  // Parse query for end time whenever query changes
  useEffect(() => {
    if (!query) return;
    const parsed = parseEndTimeFromQuery(query);
    setNlpDate(parsed);
    setUseNlpDate(!!parsed);
    setShowManual(!parsed);
    setManualDate("");
  }, [query]);

  function getExpiresAt(): string | undefined {
    if (useNlpDate && nlpDate) {
      return nlpDate.toISOString();
    }
    if (manualDate) {
      const d = new Date(manualDate);
      if (!isNaN(d.getTime()) && d.getTime() > Date.now()) {
        return d.toISOString();
      }
    }
    return undefined; // Will use server default (72h)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }

    setLoading(true);
    try {
      await onSubmit(email.trim(), getExpiresAt());
      setEmail("");
      setManualDate("");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  // Minimum datetime for the manual picker (now)
  const minDatetime = toDatetimeLocal(new Date());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Scout</DialogTitle>
          <DialogDescription>
            We'll monitor the web and email you when something happens.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="query">Watching for</Label>
            <div className="text-muted-foreground border-border/50 bg-muted/50 rounded-md border px-3 py-2 text-sm">
              {query}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <p className="text-muted-foreground text-xs">
              You'll receive an email only when an event is detected.
            </p>
          </div>

          {/* End time section */}
          <div className="space-y-2">
            <Label>Stop reporting at</Label>

            {nlpDate && (
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setUseNlpDate(true);
                    setShowManual(false);
                  }}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    useNlpDate
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border/50 bg-muted/30 text-muted-foreground hover:border-border"
                  }`}
                >
                  <span className="font-medium">{formatDate(nlpDate)}</span>
                  <span className="text-muted-foreground ml-1.5 text-xs">
                    (detected from your query)
                  </span>
                </button>
              </div>
            )}

            {/* Toggle to show manual picker */}
            {nlpDate && !showManual && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
                onClick={() => {
                  setShowManual(true);
                  setUseNlpDate(false);
                }}
              >
                Pick a different time instead
              </button>
            )}

            {/* Manual datetime picker */}
            {showManual && (
              <div className="space-y-1.5">
                <Input
                  type="datetime-local"
                  min={minDatetime}
                  value={manualDate}
                  onChange={(e) => {
                    setManualDate(e.target.value);
                    setUseNlpDate(false);
                  }}
                  className="text-sm"
                />
                {nlpDate && (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
                    onClick={() => {
                      setShowManual(false);
                      setUseNlpDate(true);
                    }}
                  >
                    Use detected time instead
                  </button>
                )}
              </div>
            )}

            {!nlpDate && !manualDate && (
              <p className="text-muted-foreground text-xs">
                Default: 3 days. Set a custom time above, or mention a time in
                your query (e.g. "today", "this week").
              </p>
            )}
          </div>

          {error && <p className="text-destructive text-sm">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Setting up scout..." : "Start Watching"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
