import { buildApp } from "../index";
import { closeDb } from "../db";
import { FastifyInstance } from "fastify";

let app: FastifyInstance;

beforeAll(async () => {
  process.env.DB_PATH = ":memory:";
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  closeDb();
});

describe("POST /runs", () => {
  it("creates a new run and returns 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        repo: { url: "git@github.com:org/repo.git", defaultBranch: "main" },
        goal: "Refactor auth module",
        constraints: { maxMinutes: 15 },
        approvals: { required: true },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toMatch(/^run_/);
    expect(body.status).toBe("queued");
    expect(body.goal).toBe("Refactor auth module");
  });
});

describe("GET /runs/:id", () => {
  it("returns the run with steps", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        repo: { url: "git@github.com:org/repo.git", defaultBranch: "main" },
        goal: "Test run",
      },
    });
    const runId = create.json().id;

    const res = await app.inject({ method: "GET", url: `/runs/${runId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(runId);
    expect(body.steps).toHaveLength(9); // DEFAULT_STEP_SEQUENCE has 9 steps
    expect(body.steps[0].type).toBe("plan");
  });

  it("returns 404 for unknown run", async () => {
    const res = await app.inject({ method: "GET", url: "/runs/run_nonexistent" });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /runs/:id/approve", () => {
  it("returns 404 for unknown run", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/runs/run_nope/approve",
      payload: { stepId: "step_x", decision: "approve" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("step leasing", () => {
  it("leases the first pending step", async () => {
    // Create a run with approvals disabled
    const create = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        repo: { url: "git@github.com:org/repo.git", defaultBranch: "main" },
        goal: "Lease test",
        approvals: { required: false },
      },
    });
    expect(create.statusCode).toBe(201);

    // Lease a step
    const lease = await app.inject({
      method: "POST",
      url: "/internal/steps/lease",
      payload: { workerId: "worker-1" },
    });
    expect(lease.statusCode).toBe(200);
    const body = lease.json();
    expect(body.step).not.toBeNull();
    expect(body.step.status).toBe("leased");
    expect(body.step.leased_by).toBe("worker-1");
  });
});

describe("step completion", () => {
  it("completes a step and updates run state", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        repo: { url: "git@github.com:org/repo.git", defaultBranch: "main" },
        goal: "Complete test",
        approvals: { required: false },
      },
    });
    const runId = create.json().id;

    // Lease a step
    const lease = await app.inject({
      method: "POST",
      url: "/internal/steps/lease",
      payload: { workerId: "worker-1" },
    });
    const stepId = lease.json().step.id;

    // Complete the step
    const complete = await app.inject({
      method: "POST",
      url: `/internal/steps/${stepId}/complete`,
      payload: { ok: true, summary: "Plan generated" },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().ok).toBe(true);
  });
});
