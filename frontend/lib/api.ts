import type {
  CreateScoutRequest,
  CreateScoutResponse,
  ScoutStatusResponse,
} from "../../worker/types";

const BASE = "/api";

export async function createScout(
  data: CreateScoutRequest,
): Promise<CreateScoutResponse> {
  const res = await fetch(`${BASE}/scouts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error((err as { error: string }).error || "Request failed");
  }
  return res.json() as Promise<CreateScoutResponse>;
}

export async function getScout(scoutId: string): Promise<ScoutStatusResponse> {
  const res = await fetch(`${BASE}/scouts/${scoutId}`);
  if (!res.ok) {
    throw new Error("Scout not found");
  }
  return res.json() as Promise<ScoutStatusResponse>;
}

export async function deleteScout(scoutId: string): Promise<void> {
  const res = await fetch(`${BASE}/scouts/${scoutId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error("Failed to delete scout");
  }
}
