import { useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface HeroSearchProps {
  onSubmit: (query: string) => void;
}

export function HeroSearch({ onSubmit }: HeroSearchProps) {
  const [query, setQuery] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed) {
      onSubmit(trimmed);
    }
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Terascout
        </h1>
        <p className="text-muted-foreground text-center text-sm">
          Event intelligence on Cloudflare. Tell me what to watch.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-xl">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            type="text"
            placeholder='e.g. "Keep me updated on NVIDIA GPU drops"'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="border-border/50 bg-card h-12 rounded-xl pr-4 pl-10 text-base shadow-sm transition-shadow focus:shadow-md"
          />
        </div>
        <p className="text-muted-foreground mt-2 text-center text-xs">
          Press Enter to create a scout
        </p>
      </form>
    </div>
  );
}
