import { Trash2, Eye, Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ScoutStatusResponse } from "../../worker/types";

interface ScoutListProps {
  scouts: ScoutStatusResponse[];
  onDelete: (scoutId: string) => void;
  loading: boolean;
}

export function ScoutList({ scouts, onDelete, loading }: ScoutListProps) {
  if (loading) {
    return (
      <div className="text-muted-foreground py-8 text-center text-sm">
        Loading scouts...
      </div>
    );
  }

  if (scouts.length === 0) {
    return (
      <div className="text-muted-foreground py-8 text-center text-sm">
        No active scouts. Create one above to get started.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Active Scouts</h2>

      {scouts.map((scout) => {
        const hasEvents = scout.events.length > 0;
        return (
          <Card key={scout.config.scoutId}>
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Eye className="h-4 w-4 shrink-0" />
                  {scout.config.query}
                </CardTitle>
                <CardDescription className="text-xs">
                  Watching {scout.config.sources.length} source
                  {scout.config.sources.length !== 1 ? "s" : ""} &middot;{" "}
                  {scout.config.email}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={hasEvents ? "default" : "secondary"}>
                  {hasEvents ? (
                    <span className="flex items-center gap-1">
                      <Radio className="h-3 w-3" />
                      Event detected
                    </span>
                  ) : (
                    "Watching"
                  )}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => onDelete(scout.config.scoutId)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>

            {hasEvents && (
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {scout.events.slice(0, 5).map((event) => (
                    <div
                      key={event.eventId}
                      className="rounded-md border border-border/50 bg-muted/30 px-3 py-2"
                    >
                      <p className="text-sm">{event.summary}</p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {event.sourceLabel} &middot;{" "}
                        {new Date(event.detectedAt).toLocaleString()}
                      </p>
                    </div>
                  ))}
                  {scout.events.length > 5 && (
                    <p className="text-muted-foreground text-xs">
                      + {scout.events.length - 5} more events
                    </p>
                  )}
                </div>
              </CardContent>
            )}

            {!hasEvents && (
              <CardContent className="pt-0">
                <div className="space-y-1">
                  <p className="text-muted-foreground text-xs">Sources:</p>
                  {scout.config.sources.map((src) => (
                    <p key={src.url} className="text-muted-foreground text-xs">
                      &bull;{" "}
                      <a
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        {src.label}
                      </a>
                    </p>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
