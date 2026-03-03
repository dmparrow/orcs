import { FastifyInstance } from "fastify";
import { v4 as uuid } from "uuid";
import { getDb } from "../db";
import {
  RunInput,
  Run,
  Step,
  ApprovalInput,
  RunEvent,
  DEFAULT_STEP_SEQUENCE,
  APPROVAL_GATED_STEPS,
  StepType,
} from "@arrowstack/shared";

export function registerRunRoutes(app: FastifyInstance): void {
  /* ---- POST /runs ---- */
  app.post("/runs", async (request, reply) => {
    const body = request.body as RunInput;
    const db = getDb();
    const runId = `run_${uuid().replace(/-/g, "").slice(0, 12)}`;

    db.prepare(
      `INSERT INTO runs (id, repo_url, default_branch, goal, max_minutes, approvals_required)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      runId,
      body.repo.url,
      body.repo.defaultBranch || "main",
      body.goal,
      body.constraints?.maxMinutes ?? 30,
      body.approvals?.required ? 1 : 0
    );

    const insertStep = db.prepare(
      `INSERT INTO steps (id, run_id, type, seq) VALUES (?, ?, ?, ?)`
    );
    const insertMany = db.transaction((steps: { id: string; type: string; seq: number }[]) => {
      for (const s of steps) {
        insertStep.run(s.id, runId, s.type, s.seq);
      }
    });

    insertMany(
      DEFAULT_STEP_SEQUENCE.map((type, i) => ({
        id: `step_${uuid().replace(/-/g, "").slice(0, 12)}`,
        type,
        seq: i,
      }))
    );

    // Emit run.state event
    db.prepare(
      `INSERT INTO events (run_id, type, payload) VALUES (?, ?, ?)`
    ).run(runId, "run.state", JSON.stringify({ status: "queued" }));

    const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as Run;
    reply.code(201).send(run);
  });

  /* ---- GET /runs/:id ---- */
  app.get("/runs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();

    const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Run | undefined;
    if (!run) {
      reply.code(404).send({ error: "Run not found" });
      return;
    }

    const steps = db.prepare("SELECT * FROM steps WHERE run_id = ? ORDER BY seq").all(id) as Step[];
    reply.send({ ...run, steps });
  });

  /* ---- POST /runs/:id/approve ---- */
  app.post("/runs/:id/approve", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as ApprovalInput;
    const db = getDb();

    const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Run | undefined;
    if (!run) {
      reply.code(404).send({ error: "Run not found" });
      return;
    }

    const step = db.prepare("SELECT * FROM steps WHERE id = ? AND run_id = ?").get(
      body.stepId,
      id
    ) as Step | undefined;
    if (!step) {
      reply.code(404).send({ error: "Step not found" });
      return;
    }
    if (step.status !== "needs_approval") {
      reply.code(409).send({ error: "Step is not awaiting approval" });
      return;
    }

    if (body.decision === "approve") {
      db.prepare("UPDATE steps SET status = 'pending' WHERE id = ?").run(step.id);

      db.prepare(`INSERT INTO events (run_id, step_id, type, payload) VALUES (?, ?, ?, ?)`).run(
        id,
        step.id,
        "approval.granted",
        JSON.stringify({ note: body.note || "" })
      );

      // If the run was in needs_approval, move it back to executing
      if (run.status === "needs_approval") {
        db.prepare("UPDATE runs SET status = 'executing', updated_at = datetime('now') WHERE id = ?").run(id);
      }
    } else {
      db.prepare("UPDATE steps SET status = 'failed' WHERE id = ?").run(step.id);
      db.prepare("UPDATE runs SET status = 'failed', updated_at = datetime('now') WHERE id = ?").run(id);
    }

    reply.send({ ok: true });
  });

  /* ---- GET /runs/:id/events (SSE) ---- */
  app.get("/runs/:id/events", async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();

    const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Run | undefined;
    if (!run) {
      reply.code(404).send({ error: "Run not found" });
      return;
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    let lastId = 0;
    const send = () => {
      const rows = db
        .prepare("SELECT * FROM events WHERE run_id = ? AND id > ? ORDER BY id")
        .all(id, lastId) as Array<{ id: number; run_id: string; step_id: string; ts: string; type: string; payload: string }>;

      for (const row of rows) {
        const event: RunEvent = {
          runId: row.run_id,
          stepId: row.step_id,
          ts: row.ts,
          type: row.type as RunEvent["type"],
          ...JSON.parse(row.payload),
        };
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        lastId = row.id;
      }
    };

    // Send existing events immediately
    send();

    // Poll for new events
    const interval = setInterval(send, 1000);

    request.raw.on("close", () => {
      clearInterval(interval);
    });
  });

  /* ---- Internal: lease a step (used by workers) ---- */
  app.post("/internal/steps/lease", async (request, reply) => {
    const { workerId } = request.body as { workerId: string };
    const db = getDb();

    // Find the next pending step across all active runs
    const step = db
      .prepare(
        `SELECT s.* FROM steps s
         JOIN runs r ON s.run_id = r.id
         WHERE s.status = 'pending'
           AND r.status IN ('queued', 'planning', 'executing')
         ORDER BY s.seq ASC
         LIMIT 1`
      )
      .get() as Step | undefined;

    if (!step) {
      reply.send({ step: null });
      return;
    }

    // Check if this step is approval-gated and the run requires approvals
    const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(step.run_id) as Run;
    if (run.approvals_required && APPROVAL_GATED_STEPS.includes(step.type as StepType)) {
      db.prepare("UPDATE steps SET status = 'needs_approval' WHERE id = ?").run(step.id);
      db.prepare("UPDATE runs SET status = 'needs_approval', updated_at = datetime('now') WHERE id = ?").run(
        step.run_id
      );
      db.prepare(`INSERT INTO events (run_id, step_id, type, payload) VALUES (?, ?, ?, ?)`).run(
        step.run_id,
        step.id,
        "approval.requested",
        JSON.stringify({ stepType: step.type })
      );
      reply.send({ step: null, awaitingApproval: true });
      return;
    }

    db.prepare(
      "UPDATE steps SET status = 'leased', leased_by = ?, leased_at = datetime('now') WHERE id = ?"
    ).run(workerId, step.id);

    // Update run status if needed
    if (run.status === "queued") {
      const newStatus = step.type === "plan" ? "planning" : "executing";
      db.prepare("UPDATE runs SET status = ?, updated_at = datetime('now') WHERE id = ?").run(newStatus, run.id);
    }

    const leased = db.prepare("SELECT * FROM steps WHERE id = ?").get(step.id) as Step;
    reply.send({ step: leased });
  });

  /* ---- Internal: complete a step ---- */
  app.post("/internal/steps/:stepId/complete", async (request, reply) => {
    const { stepId } = request.params as { stepId: string };
    const body = request.body as { ok: boolean; summary?: string };
    const db = getDb();

    const step = db.prepare("SELECT * FROM steps WHERE id = ?").get(stepId) as Step | undefined;
    if (!step) {
      reply.code(404).send({ error: "Step not found" });
      return;
    }

    const newStatus = body.ok ? "completed" : "failed";
    db.prepare(
      "UPDATE steps SET status = ?, completed_at = datetime('now'), result_summary = ? WHERE id = ?"
    ).run(newStatus, body.summary || null, stepId);

    const eventType = body.ok ? "step.completed" : "step.failed";
    db.prepare(`INSERT INTO events (run_id, step_id, type, payload) VALUES (?, ?, ?, ?)`).run(
      step.run_id,
      stepId,
      eventType,
      JSON.stringify({ summary: body.summary || "" })
    );

    // Check if all steps are done
    const remaining = db
      .prepare("SELECT COUNT(*) as cnt FROM steps WHERE run_id = ? AND status NOT IN ('completed', 'failed')")
      .get(step.run_id) as { cnt: number };

    if (remaining.cnt === 0) {
      const anyFailed = db
        .prepare("SELECT COUNT(*) as cnt FROM steps WHERE run_id = ? AND status = 'failed'")
        .get(step.run_id) as { cnt: number };

      const finalStatus = anyFailed.cnt > 0 ? "failed" : "completed";
      db.prepare("UPDATE runs SET status = ?, updated_at = datetime('now') WHERE id = ?").run(
        finalStatus,
        step.run_id
      );
      db.prepare(`INSERT INTO events (run_id, type, payload) VALUES (?, ?, ?)`).run(
        step.run_id,
        "run.state",
        JSON.stringify({ status: finalStatus })
      );
    }

    reply.send({ ok: true });
  });

  /* ---- Internal: emit event ---- */
  app.post("/internal/events", async (request, reply) => {
    const body = request.body as RunEvent;
    const db = getDb();

    db.prepare(`INSERT INTO events (run_id, step_id, type, payload) VALUES (?, ?, ?, ?)`).run(
      body.runId,
      body.stepId || null,
      body.type,
      JSON.stringify({
        agent: body.agent,
        tool: body.tool,
        ok: body.ok,
        durationMs: body.durationMs,
        summary: body.summary,
      })
    );

    reply.send({ ok: true });
  });
}
