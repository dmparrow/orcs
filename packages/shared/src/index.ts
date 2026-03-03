/* ---- Run ---- */

export type RunStatus =
  | "queued"
  | "planning"
  | "executing"
  | "needs_approval"
  | "completed"
  | "failed"
  | "canceled";

export interface RunInput {
  repo: { url: string; defaultBranch: string };
  goal: string;
  constraints?: { maxMinutes?: number };
  approvals?: { required?: boolean };
}

export interface Run {
  id: string;
  status: RunStatus;
  repo_url: string;
  default_branch: string;
  goal: string;
  max_minutes: number;
  approvals_required: boolean;
  created_at: string;
  updated_at: string;
}

/* ---- Step ---- */

export type StepType =
  | "plan"
  | "clone_repo"
  | "analyze_repo"
  | "generate_patch"
  | "apply_patch"
  | "run_tests"
  | "commit_branch"
  | "push_branch"
  | "finalize";

export type StepStatus =
  | "pending"
  | "leased"
  | "running"
  | "needs_approval"
  | "completed"
  | "failed";

export const APPROVAL_GATED_STEPS: StepType[] = [
  "apply_patch",
  "commit_branch",
  "push_branch",
];

export interface Step {
  id: string;
  run_id: string;
  type: StepType;
  status: StepStatus;
  seq: number;
  leased_by: string | null;
  leased_at: string | null;
  completed_at: string | null;
  result_summary: string | null;
}

/* ---- Events ---- */

export type EventType =
  | "run.state"
  | "plan.created"
  | "step.started"
  | "step.completed"
  | "step.failed"
  | "tool.call"
  | "tool.result"
  | "approval.requested"
  | "approval.granted"
  | "artifact.written";

export interface RunEvent {
  id?: number;
  runId: string;
  stepId: string;
  ts: string;
  type: EventType;
  agent?: string;
  tool?: string;
  ok?: boolean;
  durationMs?: number;
  summary?: string;
}

/* ---- Approval ---- */

export interface ApprovalInput {
  stepId: string;
  decision: "approve" | "reject";
  note?: string;
}

/* ---- Default step sequence for a new run ---- */

export const DEFAULT_STEP_SEQUENCE: StepType[] = [
  "plan",
  "clone_repo",
  "analyze_repo",
  "generate_patch",
  "apply_patch",
  "run_tests",
  "commit_branch",
  "push_branch",
  "finalize",
];
