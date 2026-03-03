# Arrowstack Orchestrator --- Core Architecture Brief

## Objective

Design and implement a Kubernetes-native Agent Orchestrator capable of:

-   Managing multi-step agent runs
-   Coordinating specialist workers
-   Executing MCP-based tool calls
-   Enforcing approval gates
-   Providing full observability via ui-agent-view
-   Supporting future multi-tenant SaaS expansion

------------------------------------------------------------------------

## System Overview

The Arrowstack Orchestrator is composed of:

1.  **Orchestrator API (Control Plane)**
2.  **Agent Workers (Execution Plane)**
3.  **MCP Toolbox (Tool Surface)**
4.  **Persistent Artifact Store**
5.  **Vector Retrieval Layer (Optional, Phase 2)**
6.  **ui-agent-view (Observability UI)**

------------------------------------------------------------------------

## High-Level Architecture

Client → Orchestrator API → Worker → MCP Toolbox\
↓\
ui-agent-view

Only the Orchestrator API and UI are externally exposed via Ingress.

------------------------------------------------------------------------

## Core Concepts

### Run

A Run represents a complete execution of a goal.

Example: \> "Refactor auth module to use Keycloak, run tests, open
branch"

Run States: - queued - planning - executing - needs_approval -
completed - failed - canceled

------------------------------------------------------------------------

### Step

Each Run consists of ordered Steps.

Step Types: - plan - clone_repo - analyze_repo - generate_patch -
apply_patch (approval gated) - run_tests - commit_branch (approval
gated) - push_branch (approval gated) - finalize

------------------------------------------------------------------------

## Workspace Layout

Per-run workspace:

/workspace/runs/`<runId>`{=html}/repo\
/runs/`<runId>`{=html}/plan.md\
/runs/`<runId>`{=html}/changes.patch\
/runs/`<runId>`{=html}/logs/\
/runs/`<runId>`{=html}/reports/

-   `/workspace` = ephemeral (emptyDir)
-   `/runs` = PersistentVolumeClaim

------------------------------------------------------------------------

## API Contract

### POST /runs

Creates a new run.

``` json
{
  "repo": { "url": "git@host:org/repo.git", "defaultBranch": "main" },
  "goal": "Refactor X to Y and run tests",
  "constraints": { "maxMinutes": 30 },
  "approvals": { "required": true }
}
```

------------------------------------------------------------------------

### GET /runs/:id

Returns run status and step list.

------------------------------------------------------------------------

### POST /runs/:id/approve

``` json
{
  "stepId": "step_09",
  "decision": "approve",
  "note": "Safe to push"
}
```

------------------------------------------------------------------------

### GET /runs/:id/events (SSE)

Streams structured execution events.

------------------------------------------------------------------------

## Event Schema

Each event is JSON:

``` json
{
  "runId": "run_123",
  "stepId": "step_07",
  "ts": "2026-03-03T06:12:33.120Z",
  "type": "tool.result",
  "agent": "repo-worker",
  "tool": "git.diff",
  "ok": true,
  "durationMs": 184,
  "summary": "12 files changed"
}
```

Event Types: - run.state - plan.created - step.started -
step.completed - step.failed - tool.call - tool.result -
approval.requested - approval.granted - artifact.written

------------------------------------------------------------------------

## MCP Toolbox Responsibilities

Expose safe, allowlisted tools:

### repo.clone

### repo.search

### repo.read

### repo.apply_patch (approval gated)

### runner.exec (allowlisted commands only)

Allowed commands: - git - pnpm / npm / yarn - docker (optional) -
test/build scripts

### git.commit_branch (approval gated)

### git.push (approval gated)

Security rules: - Timeout limits - Max output size - Secret redaction -
Internal-only network exposure

------------------------------------------------------------------------

## Worker Execution Loop

1.  Lease step from Orchestrator
2.  Emit step.started event
3.  Execute tool calls via MCP
4.  Emit tool.call and tool.result events
5.  Write artifacts
6.  Submit step result
7.  Repeat until no steps available

Workers scale horizontally in Kubernetes.

------------------------------------------------------------------------

## Kubernetes Deployment Model

Namespace: agent-system

Deployments: - orchestrator - agent-worker (replicas \>1) -
mcp-toolbox - ui-agent-view

Storage: - PersistentVolumeClaim for `/runs`

Networking: - ClusterIP for internal services - Ingress only for
orchestrator and UI - NetworkPolicies enforcing least privilege

------------------------------------------------------------------------

## Security Model

-   Approval gates for destructive operations
-   No public exposure of workers or MCP toolbox
-   Secret injection via Kubernetes Secrets
-   No Kubernetes API access required for workers
-   Optional mTLS + Keycloak integration for internal auth

------------------------------------------------------------------------

## Scaling Strategy

-   Increase worker replicas for parallel runs
-   Use Job-per-run model for strict isolation (future)
-   Add queue backpressure and rate limits
-   Introduce priority classes if needed

------------------------------------------------------------------------

## Success Criteria

-   Full run lifecycle visible in ui-agent-view
-   Safe execution of repo modifications
-   Deterministic audit trail
-   Kubernetes-native scaling
-   Extensible tool surface via MCP
-   Ready for future multi-tenant architecture

------------------------------------------------------------------------

## Future Extensions

-   Vector DB (RAG)
-   Cross-repo knowledge graph
-   Multi-agent specialization
-   CI/CD integration
-   SaaS control plane

------------------------------------------------------------------------

Version: 1.0\
Owner: Arrowstack Agent System
