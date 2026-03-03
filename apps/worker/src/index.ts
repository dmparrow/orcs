import { v4 as uuid } from "uuid";
import { leaseStep, completeStep, emitEvent } from "./api-client";
import { executeStep } from "./executor";

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "3000", 10);
const WORKER_ID = process.env.WORKER_ID || `worker_${uuid().replace(/-/g, "").slice(0, 8)}`;

let running = true;

export function stopWorker(): void {
  running = false;
}

/**
 * Main worker loop.
 * 1. Lease a step from the orchestrator
 * 2. Emit step.started event
 * 3. Execute the step
 * 4. Report step completion
 * 5. Repeat until no steps available, then wait and poll
 */
export async function runWorkerLoop(): Promise<void> {
  console.log(`Worker ${WORKER_ID} starting…`);

  while (running) {
    try {
      const step = await leaseStep(WORKER_ID);

      if (!step) {
        // No work available, wait and retry
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      console.log(`Leased step ${step.id} (${step.type}) for run ${step.run_id}`);

      // Emit step.started
      await emitEvent({
        runId: step.run_id,
        stepId: step.id,
        type: "step.started",
        agent: WORKER_ID,
        summary: `Starting ${step.type}`,
      });

      // Execute the step
      const start = Date.now();
      const result = await executeStep(step);
      const durationMs = Date.now() - start;

      console.log(`Step ${step.id} ${result.ok ? "completed" : "failed"}: ${result.summary} (${durationMs}ms)`);

      // Report completion
      await completeStep(step.id, result.ok, result.summary);
    } catch (err) {
      console.error("Worker loop error:", err);
      await sleep(POLL_INTERVAL_MS);
    }
  }

  console.log(`Worker ${WORKER_ID} stopped.`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* istanbul ignore next */
if (require.main === module) {
  process.on("SIGTERM", () => stopWorker());
  process.on("SIGINT", () => stopWorker());
  runWorkerLoop();
}
