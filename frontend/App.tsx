import { useState } from "react";
import reactLogo from "./assets/react.svg";
import viteLogo from "/vite.svg";
import cloudflareLogo from "./assets/Cloudflare_Logo.svg";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function App() {
  const [count, setCount] = useState(0);
  const [name, setName] = useState("unknown");

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="mx-auto max-w-2xl px-6 py-12">
        {/* Header */}
        <header className="mb-12 flex flex-col items-center gap-4">
          <div className="flex items-center gap-4">
            <a
              href="https://vite.dev"
              target="_blank"
              rel="noreferrer"
              className="opacity-80 transition-opacity hover:opacity-100"
            >
              <img
                src={viteLogo}
                alt="Vite"
                className="h-8 w-8"
              />
            </a>
            <a
              href="https://react.dev"
              target="_blank"
              rel="noreferrer"
              className="opacity-80 transition-opacity hover:opacity-100"
            >
              <img
                src={reactLogo}
                alt="React"
                className="h-8 w-8"
              />
            </a>
            <a
              href="https://workers.cloudflare.com/"
              target="_blank"
              rel="noreferrer"
              className="opacity-80 transition-opacity hover:opacity-100"
            >
              <img
                src={cloudflareLogo}
                alt="Cloudflare"
                className="h-8 w-8"
              />
            </a>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Vite + React + Cloudflare
          </h1>
          <p className="text-muted-foreground text-center text-sm">
            Terascout — Edit <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">frontend/App.tsx</code> and save to test HMR
          </p>
        </header>

        {/* Cards */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Counter</CardTitle>
              <CardDescription>
                Click the button to increment the count
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => setCount((c) => c + 1)}
                aria-label="increment"
              >
                Count is {count}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>API Demo</CardTitle>
              <CardDescription>
                Fetch data from the Worker API
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="secondary"
                onClick={() => {
                  fetch("/api/")
                    .then((res) => res.json() as Promise<{ name: string }>)
                    .then((data) => setName(data.name));
                }}
                aria-label="get name"
              >
                Name from API: {name}
              </Button>
            </CardContent>
            <CardFooter>
              <p className="text-muted-foreground text-xs">
                Edit <code className="rounded bg-muted px-1.5 py-0.5 font-mono">worker/index.ts</code> to change the API response
              </p>
            </CardFooter>
          </Card>
        </div>

        <p className="text-muted-foreground mt-8 text-center text-sm">
          Click on the logos to learn more
        </p>
      </div>
    </div>
  );
}

export default App;
