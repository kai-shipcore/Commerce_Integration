import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

const logAuditMock = vi.fn();
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

let lastChild: FakeChildProcess;
const spawnMock = vi.fn((_command: string, _args: string[]) => {
  lastChild = new FakeChildProcess();
  return lastChild;
});
vi.mock("child_process", () => ({ spawn: spawnMock }));

// The service holds its `activeRun` state in a module-level singleton (by
// design — matches the original route-level implementation). Reset the
// module and re-import before every test so each test starts from a truly
// idle state instead of depending on the previous test's cleanup.
let ContainerImportService: typeof import("@/lib/container-import/service")["ContainerImportService"];

const WHO = { userId: "u1", userName: "Alice", userEmail: "a@x.com" };

async function readAllChunks(stream: ReadableStream): Promise<string[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value));
  }
  return chunks;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  ({ ContainerImportService } = await import("@/lib/container-import/service"));
});

describe("ContainerImportService.getStatus", () => {
  it("reports idle when no run has started", () => {
    expect(ContainerImportService.getStatus()).toEqual({ status: "idle" });
  });
});

describe("ContainerImportService.startRun", () => {
  it("spawns the tsx CLI with the sheet url and starts a run", () => {
    const result = ContainerImportService.startRun({ url: "https://sheet", dryRun: false, forceDownload: false }, WHO);

    expect(result.conflict).toBe(false);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, args] = spawnMock.mock.calls[0];
    expect(args).toContain("https://sheet");

    expect(ContainerImportService.getStatus().status).toBe("running");

    lastChild.emit("close", 0);
  });

  it("returns a conflict when a run is already active", () => {
    ContainerImportService.startRun({ url: "https://sheet", dryRun: false, forceDownload: false }, WHO);
    const second = ContainerImportService.startRun({ url: "https://other", dryRun: false, forceDownload: false }, WHO);

    expect(second.conflict).toBe(true);
    lastChild.emit("close", 0);
  });

  it("streams stdout lines and marks done + audit-logs on a clean close", async () => {
    const result = ContainerImportService.startRun({ url: "https://sheet", dryRun: true, forceDownload: false }, WHO);
    if (result.conflict) throw new Error("expected no conflict");

    const chunksPromise = readAllChunks(result.stream);
    lastChild.stdout.emit("data", Buffer.from("importing row 1\n"));
    lastChild.emit("close", 0);
    const chunks = await chunksPromise;

    expect(chunks.some((c) => c.includes("importing row 1"))).toBe(true);
    expect(chunks.some((c) => c.includes('"done":true'))).toBe(true);
    expect(ContainerImportService.getStatus().status).toBe("done");
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "container_import", action: "create", after: expect.objectContaining({ exitCode: 0, dryRun: true }),
    }));
  });

  it("does not audit-log a cancelled run's own close event", async () => {
    const result = ContainerImportService.startRun({ url: "https://sheet", dryRun: false, forceDownload: false }, WHO);
    if (result.conflict) throw new Error("expected no conflict");

    ContainerImportService.cancelRun();
    lastChild.emit("close", null);

    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("marks done and audit-logs on a spawn error", () => {
    const result = ContainerImportService.startRun({ url: "https://sheet", dryRun: false, forceDownload: false }, WHO);
    if (result.conflict) throw new Error("expected no conflict");

    lastChild.emit("error", new Error("ENOENT"));

    expect(ContainerImportService.getStatus().status).toBe("done");
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "create", after: expect.objectContaining({ error: "ENOENT" }),
    }));
  });
});

describe("ContainerImportService.cancelRun", () => {
  it("reports notFound when nothing is running", () => {
    const result = ContainerImportService.cancelRun();
    expect(result).toEqual({ notFound: true });
  });

  it("kills the child and marks the run cancelled", () => {
    ContainerImportService.startRun({ url: "https://sheet", dryRun: false, forceDownload: false }, WHO);

    const result = ContainerImportService.cancelRun();

    expect(result).toEqual({ ok: true });
    expect(lastChild.kill).toHaveBeenCalledWith("SIGTERM");
    expect(ContainerImportService.getStatus().status).toBe("cancelled");
  });

  it("reports notFound for a run that already finished", () => {
    ContainerImportService.startRun({ url: "https://sheet", dryRun: false, forceDownload: false }, WHO);
    lastChild.emit("close", 0);

    const result = ContainerImportService.cancelRun();
    expect(result).toEqual({ notFound: true });
  });
});

describe("ContainerImportService.subscribeStream", () => {
  it("immediately closes with a done event when idle", async () => {
    const chunks = await readAllChunks(ContainerImportService.subscribeStream());
    expect(chunks.some((c) => c.includes('"done":true'))).toBe(true);
  });

  it("replays the buffered log for a running import", async () => {
    ContainerImportService.startRun({ url: "https://sheet", dryRun: false, forceDownload: false }, WHO);
    lastChild.stdout.emit("data", Buffer.from("row 1\n"));

    // give the stdout 'data' listener a tick to run before subscribing
    await new Promise((resolve) => setTimeout(resolve, 0));

    const stream = ContainerImportService.subscribeStream();
    const reader = stream.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain("row 1");

    lastChild.emit("close", 0);
  });
});
