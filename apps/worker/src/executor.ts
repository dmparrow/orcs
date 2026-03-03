import { Step, StepType } from "@arrowstack/shared";
import { emitEvent } from "./api-client";
import fs from "fs";
import path from "path";

function getRunsDir(): string {
  return process.env.RUNS_DIR || "/runs";
}

/** Ensure a run's artifact directory exists. */
function ensureRunDir(runId: string): string {
  const dir = path.join(getRunsDir(), runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "logs"), { recursive: true });
  fs.mkdirSync(path.join(dir, "reports"), { recursive: true });
  return dir;
}

/** Write an artifact file under /runs/<runId>/. */
export function writeArtifact(runId: string, relativePath: string, content: string): void {
  const fullPath = path.join(getRunsDir(), runId, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
}

export type StepHandler = (step: Step) => Promise<{ ok: boolean; summary: string }>;

/**
 * Registry of step handlers. Each step type maps to a function that executes the step.
 * In a full implementation, these would call MCP tools, LLMs, etc.
 */
const handlers: Partial<Record<StepType, StepHandler>> = {
  plan: async (step) => {
    const runDir = ensureRunDir(step.run_id);
    const plan = `# Plan for ${step.run_id}\n\nGenerated at ${new Date().toISOString()}\n\n- [ ] Analyze repository\n- [ ] Generate patches\n- [ ] Run tests\n`;
    writeArtifact(step.run_id, "plan.md", plan);

    await emitEvent({
      runId: step.run_id,
      stepId: step.id,
      type: "plan.created",
      summary: "Plan generated",
    });
    await emitEvent({
      runId: step.run_id,
      stepId: step.id,
      type: "artifact.written",
      summary: "plan.md",
    });

    return { ok: true, summary: "Plan generated" };
  },

  clone_repo: async (step) => {
    ensureRunDir(step.run_id);
    await emitEvent({
      runId: step.run_id,
      stepId: step.id,
      type: "tool.call",
      tool: "repo.clone",
      agent: "repo-worker",
    });

    // In a real implementation, this would call MCP repo.clone
    await emitEvent({
      runId: step.run_id,
      stepId: step.id,
      type: "tool.result",
      tool: "repo.clone",
      agent: "repo-worker",
      ok: true,
      summary: "Repository cloned",
    });

    return { ok: true, summary: "Repository cloned (stub)" };
  },

  analyze_repo: async (step) => {
    return { ok: true, summary: "Repository analyzed (stub)" };
  },

  generate_patch: async (step) => {
    writeArtifact(step.run_id, "changes.patch", "# Empty patch placeholder\n");
    await emitEvent({
      runId: step.run_id,
      stepId: step.id,
      type: "artifact.written",
      summary: "changes.patch",
    });
    return { ok: true, summary: "Patch generated (stub)" };
  },

  apply_patch: async (step) => {
    return { ok: true, summary: "Patch applied (stub)" };
  },

  run_tests: async (step) => {
    writeArtifact(step.run_id, "reports/test-results.json", JSON.stringify({ passed: 0, failed: 0 }));
    return { ok: true, summary: "Tests passed (stub)" };
  },

  commit_branch: async (step) => {
    return { ok: true, summary: "Branch committed (stub)" };
  },

  push_branch: async (step) => {
    return { ok: true, summary: "Branch pushed (stub)" };
  },

  finalize: async (step) => {
    writeArtifact(
      step.run_id,
      "reports/summary.json",
      JSON.stringify({ completedAt: new Date().toISOString() })
    );
    return { ok: true, summary: "Run finalized" };
  },
};

/** Execute a single step using the registered handler. */
export async function executeStep(step: Step): Promise<{ ok: boolean; summary: string }> {
  const handler = handlers[step.type as StepType];
  if (!handler) {
    return { ok: false, summary: `No handler for step type: ${step.type}` };
  }
  return handler(step);
}
