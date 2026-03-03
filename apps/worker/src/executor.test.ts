import { executeStep, writeArtifact } from "./executor";
import { Step } from "@arrowstack/shared";
import fs from "fs";
import path from "path";
import os from "os";

// Mock the api-client so executor tests don't need a running API
jest.mock("./api-client", () => ({
  emitEvent: jest.fn().mockResolvedValue(undefined),
}));

const tmpDir = path.join(os.tmpdir(), "arrowstack-worker-test");

beforeAll(() => {
  process.env.RUNS_DIR = tmpDir;
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeStep(type: string): Step {
  return {
    id: "step_test123",
    run_id: "run_test456",
    type: type as Step["type"],
    status: "leased",
    seq: 0,
    leased_by: "worker-test",
    leased_at: new Date().toISOString(),
    completed_at: null,
    result_summary: null,
  };
}

describe("executeStep", () => {
  it("executes plan step and writes plan.md", async () => {
    const result = await executeStep(makeStep("plan"));
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("Plan");
    expect(fs.existsSync(path.join(tmpDir, "run_test456", "plan.md"))).toBe(true);
  });

  it("executes finalize step and writes summary", async () => {
    const result = await executeStep(makeStep("finalize"));
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "run_test456", "reports", "summary.json"))).toBe(true);
  });

  it("returns failure for unknown step type", async () => {
    const result = await executeStep(makeStep("unknown_type"));
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("No handler");
  });
});

describe("writeArtifact", () => {
  it("writes a file to the correct path", () => {
    writeArtifact("run_art", "test-artifact.txt", "hello");
    const content = fs.readFileSync(path.join(tmpDir, "run_art", "test-artifact.txt"), "utf-8");
    expect(content).toBe("hello");
  });
});
