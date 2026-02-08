import {
  Trash2,
  Eye,
  Radio,
  Zap,
  Clock,
  ExternalLink,
  Newspaper,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ScoutStatusResponse, Article } from "../../worker/types";

interface ScoutListProps {
  scouts: ScoutStatusResponse[];
  onDelete: (scoutId: string) => void;
  loading: boolean;
}

function formatTimeLeft(expiresAt: string): string {
  if (!expiresAt) return "";
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h left`;
  if (hours > 0) return `${hours}h left`;
  const mins = Math.floor(diff / (1000 * 60));
  return `${mins}m left`;
}

function ArticleCard({ article }: { article: Article }) {
  return (
    <a
      href={article.url || "#"}
      target="_blank"
      rel="noopener noreferrer"
      className="border-border/50 bg-muted/20 hover:bg-muted/40 group block rounded-lg border p-3 transition-colors"
    >
      <div className="flex gap-3">
        {article.imageUrl && (
          <div className="h-16 w-24 shrink-0 overflow-hidden rounded-md">
            <img
              src={article.imageUrl}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="group-hover:text-primary text-sm leading-tight font-medium">
            {article.title}
            {article.url && (
              <ExternalLink className="ml-1 inline-block h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
            )}
          </p>
          {article.snippet && (
            <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-relaxed">
              {article.snippet}
            </p>
          )}
        </div>
      </div>
    </a>
  );
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
        const timeLeft = formatTimeLeft(scout.config.expiresAt);

        return (
          <Card key={scout.config.scoutId}>
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Eye className="h-4 w-4 shrink-0" />
                  {scout.config.query}
                </CardTitle>
                <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  <span>{scout.config.email}</span>
                  {timeLeft && (
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {timeLeft}
                    </span>
                  )}
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
                  className="text-muted-foreground hover:text-destructive h-8 w-8"
                  onClick={() => onDelete(scout.config.scoutId)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>

            {hasEvents && (
              <CardContent className="pt-0">
                <div className="space-y-3">
                  {scout.events.slice(0, 5).map((event) => (
                    <div
                      key={event.eventId}
                      className="border-border/50 overflow-hidden rounded-lg border"
                    >
                      {/* Event header */}
                      <div className="bg-muted/30 px-4 py-3">
                        <div className="flex items-start gap-2">
                          {event.isBreaking && (
                            <Badge
                              variant="destructive"
                              className="shrink-0 px-1.5 py-0 text-[10px]"
                            >
                              <Zap className="mr-0.5 h-2.5 w-2.5" />
                              Breaking
                            </Badge>
                          )}
                          <div className="min-w-0 flex-1">
                            {/* TLDR */}
                            {event.tldr && (
                              <p className="text-sm leading-tight font-semibold">
                                {event.tldr}
                              </p>
                            )}
                            {/* Full summary */}
                            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                              {event.summary}
                            </p>
                          </div>
                        </div>

                        {/* Highlights */}
                        {event.highlights && event.highlights.length > 0 && (
                          <ul className="mt-2 space-y-1 pl-4">
                            {event.highlights.map((h, i) => (
                              <li
                                key={i}
                                className="text-muted-foreground list-disc text-xs leading-relaxed"
                              >
                                {h}
                              </li>
                            ))}
                          </ul>
                        )}

                        <p className="text-muted-foreground mt-2 text-[11px]">
                          {new Date(event.detectedAt).toLocaleString()}
                        </p>
                      </div>

                      {/* Articles */}
                      {event.articles && event.articles.length > 0 && (
                        <div className="border-border/30 border-t px-4 py-3">
                          <p className="text-muted-foreground mb-2 flex items-center gap-1 text-[11px] font-medium tracking-wider uppercase">
                            <Newspaper className="h-3 w-3" />
                            Related Articles
                          </p>
                          <div className="space-y-2">
                            {event.articles.map((article, i) => (
                              <ArticleCard key={i} article={article} />
                            ))}
                          </div>
                        </div>
                      )}
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
                <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <div className="bg-primary/20 h-1.5 w-1.5 animate-pulse rounded-full" />
                  Monitoring — we'll notify you when something happens
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
