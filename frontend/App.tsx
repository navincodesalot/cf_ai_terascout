import { useCallback, useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import { HeroSearch } from "@/components/HeroSearch";
import { ScoutForm } from "@/components/ScoutForm";
import { ScoutList } from "@/components/ScoutList";
import { createScout, getScout, deleteScout } from "@/lib/api";
import type { ScoutStatusResponse } from "../worker/types";

const STORAGE_KEY = "terascout_scout_ids";

function loadScoutIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveScoutIds(ids: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

function App() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingQuery, setPendingQuery] = useState("");
  const [scouts, setScouts] = useState<ScoutStatusResponse[]>([]);
  const [loadingScouts, setLoadingScouts] = useState(true);

  // Load saved scouts on mount
  const refreshScouts = useCallback(async () => {
    const ids = loadScoutIds();
    if (ids.length === 0) {
      setScouts([]);
      setLoadingScouts(false);
      return;
    }

    setLoadingScouts(true);
    const results: ScoutStatusResponse[] = [];
    const validIds: string[] = [];

    for (const id of ids) {
      try {
        const data = await getScout(id);
        results.push(data);
        validIds.push(id);
      } catch {
        // Scout may have been deleted or doesn't exist
      }
    }

    // Clean up invalid IDs
    saveScoutIds(validIds);
    setScouts(results);
    setLoadingScouts(false);
  }, []);

  useEffect(() => {
    refreshScouts();
  }, [refreshScouts]);

  // Search bar submit → open dialog
  function handleSearch(query: string) {
    setPendingQuery(query);
    setDialogOpen(true);
  }

  // Dialog submit → create scout
  async function handleCreateScout(email: string, expiresAt?: string) {
    const result = await createScout({ query: pendingQuery, email, expiresAt });

    // Save to local storage
    const ids = loadScoutIds();
    ids.unshift(result.scoutId);
    saveScoutIds(ids);

    toast.success("Scout created! We'll email you when something happens.", {
      duration: 5000,
    });

    setSearchQuery("");
    await refreshScouts();
  }

  // Delete scout
  async function handleDelete(scoutId: string) {
    try {
      await deleteScout(scoutId);
      const ids = loadScoutIds().filter((id) => id !== scoutId);
      saveScoutIds(ids);
      setScouts((prev) => prev.filter((s) => s.config.scoutId !== scoutId));
      toast.success("Scout deleted.");
    } catch {
      toast.error("Failed to delete scout.");
    }
  }

  return (
    <div className="dark bg-background text-foreground min-h-screen">
      <div className="mx-auto max-w-2xl px-6 py-16">
        {/* Hero / Search */}
        <div className="mb-12">
          <HeroSearch
            value={searchQuery}
            onChange={setSearchQuery}
            onSubmit={handleSearch}
          />
        </div>

        {/* Scout Form Dialog */}
        <ScoutForm
          query={pendingQuery}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSubmit={handleCreateScout}
        />

        {/* Active Scouts */}
        <ScoutList
          scouts={scouts}
          onDelete={handleDelete}
          loading={loadingScouts}
        />

        {/* Footer */}
        <footer className="text-muted-foreground mt-16 text-center text-xs">
          <p>
            built with ❤️ by{" "}
            <a
              href="https://github.com/navincodesalot/cf_ai_terascout"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground underline underline-offset-2"
            >
              navin
            </a>
          </p>
        </footer>
      </div>

      <Toaster theme="dark" position="bottom-right" />
    </div>
  );
}

export default App;
