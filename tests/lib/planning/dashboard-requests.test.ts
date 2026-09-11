import { describe, expect, it } from "vitest";
import { DashboardRequestLane } from "@/features/planning/dashboard-requests";

describe("dashboard request ownership", () => {
  it("ignores late responses and cleanup across A -> B -> A", async () => {
    const lane = new DashboardRequestLane();
    let resolveOld!: () => void;
    const delayed = new Promise<void>(resolve => { resolveOld = resolve; });
    const a = lane.start();
    let display = "initial";
    const oldResponse = delayed.then(() => {
      if (lane.isCurrent(a)) display = "stale A";
      lane.finish(a);
    });
    const b = lane.start();
    const nextA = lane.start();
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(true);
    resolveOld();
    await oldResponse;
    expect(display).toBe("initial");
    expect(lane.isCurrent(nextA)).toBe(true);
    expect(lane.isPending()).toBe(true);
  });

  it("can retry a failed request, and old finalizers cannot clear the retry", () => {
    const lane = new DashboardRequestLane();
    const failed = lane.start();
    expect(lane.finish(failed)).toBe(true);
    const retry = lane.start();
    expect(lane.finish(failed)).toBe(false);
    expect(lane.isCurrent(retry)).toBe(true);
  });

  it("cancels in-flight work on unmount and recognizes a current timeout", () => {
    const lane = new DashboardRequestLane();
    const request = lane.start();
    lane.cancel();
    expect(request.signal.aborted).toBe(true);
    expect(lane.finish(request)).toBe(false);
    const timedOut = lane.start();
    timedOut.abort();
    expect(lane.isCurrent(timedOut)).toBe(false);
    expect(lane.finish(timedOut)).toBe(true);
  });
});
