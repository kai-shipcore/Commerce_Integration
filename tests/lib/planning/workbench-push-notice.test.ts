import { describe, expect, it } from "vitest";
import { workbenchPushNotice } from "@/features/planning/workbench-push-notice";

const ko = (korean: string) => korean;
const en = (_korean: string, english: string) => english;

const base = {
  target: "staging.cowork.coverland.com",
  considered: 160,
  sent: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  failed: 0,
  skipped: 0,
  skipReasons: {},
  errors: [] as string[],
  durationMs: 10,
};

describe("workbenchPushNotice", () => {
  it("says nothing for an older job without a push, or one not configured", () => {
    expect(workbenchPushNotice(undefined, ko)).toBeNull();
    expect(workbenchPushNotice({ status: "skipped", reason: "WORKBENCH_API_URL or WORKBENCH_API_KEY is not set" }, ko)).toBeNull();
  });

  it("reports created and updated containers as a success", () => {
    const notice = workbenchPushNotice({ ...base, status: "succeeded", sent: 3, created: 1, updated: 2, skipped: 25 }, ko);
    expect(notice).toEqual({
      level: "success",
      message: "Workbench 컨테이너 반영 완료",
      description: "신규 1 · 변경 2 · 동일 0 · 제외 25",
    });
  });

  it("reports a push that changed nothing as information", () => {
    const notice = workbenchPushNotice({ ...base, status: "succeeded", sent: 135, unchanged: 135 }, en);
    expect(notice).toEqual({
      level: "info",
      message: "Workbench: no container changes",
      description: "0 new · 0 updated · 135 unchanged",
    });
  });

  it("warns on a partial push, counts the missing SKUs, and points to Sync History", () => {
    const notice = workbenchPushNotice(
      { ...base, status: "partial", sent: 1, created: 1, failed: 134, skipped: 25, missingSkuCount: 2431 },
      ko,
    );
    expect(notice?.level).toBe("warning");
    expect(notice?.message).toBe("Workbench 일부 컨테이너 실패");
    expect(notice?.description).toBe(
      "신규 1 · 변경 0 · 동일 0 · 실패 134 · 제외 25. Workbench에 없는 SKU 2,431개. 자세한 내용은 동기화 이력에서 확인하세요.",
    );
  });

  it("explains an all-rejected push by its missing SKUs when there is no general error", () => {
    const notice = workbenchPushNotice({ ...base, status: "failed", failed: 135, missingSkuCount: 12 }, en);
    expect(notice?.description).toBe(
      "0 new · 0 updated · 0 unchanged · 135 failed. 12 SKUs are not in Workbench. See Sync History for details.",
    );
  });

  it("shows the first error, shortened, when the push failed", () => {
    const long = `Workbench POST /api/v1/inbound-containers/import → 401: ${"x".repeat(400)}`;
    const notice = workbenchPushNotice({ ...base, status: "failed", failed: 135, errors: [long] }, en);
    expect(notice?.level).toBe("error");
    expect(notice?.message).toBe("Workbench push failed");
    expect(notice?.description?.endsWith("…")).toBe(true);
    expect(notice?.description?.length).toBe(241);
  });

  it("warns when the push crashed", () => {
    const notice = workbenchPushNotice({ status: "skipped", reason: "Workbench push crashed: boom" }, en);
    expect(notice).toEqual({ level: "warning", message: "Workbench push skipped", description: "Workbench push crashed: boom" });
  });
});
