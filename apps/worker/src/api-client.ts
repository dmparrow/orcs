import { Step, RunEvent, StepType } from "@arrowstack/shared";

const API_BASE = process.env.API_URL || "http://localhost:3000";

/** POST helper with JSON body. */
async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<T>;
}

/** Lease the next available step from the orchestrator. */
export async function leaseStep(workerId: string): Promise<Step | null> {
  const result = await post<{ step: Step | null }>("/internal/steps/lease", { workerId });
  return result.step;
}

/** Report step completion to the orchestrator. */
export async function completeStep(stepId: string, ok: boolean, summary: string): Promise<void> {
  await post(`/internal/steps/${stepId}/complete`, { ok, summary });
}

/** Emit an event to the orchestrator. */
export async function emitEvent(event: Omit<RunEvent, "ts">): Promise<void> {
  await post("/internal/events", { ...event, ts: new Date().toISOString() });
}
