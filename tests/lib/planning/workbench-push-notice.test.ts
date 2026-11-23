import { describe, expect, it } from "vitest";
import { workbenchPushNotice, workbenchSalesRateNotice } from "@/features/planning/workbench-push-notice";

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

const salesRateBase = {
  target: "staging.cowork.coverland.com",
  considered: 6_700,
  sent: 0,
  changed: 0,
  unknownSkuCount: 0,
  draftSkuCount: 0,
  notSentSkus: [] as string[],
  failed: 0,
  errors: [] as string[],
  durationMs: 10,
};

describe("workbenchSalesRateNotice", () => {
  it("says nothing for an older job without a push, or one not configured", () => {
    expect(workbenchSalesRateNotice(undefined, ko)).toBeNull();
    expect(
      workbenchSalesRateNotice({ status: "skipped", reason: "WORKBENCH_API_URL or WORKBENCH_API_KEY is not set" }, ko),
    ).toBeNull();
  });

  it("reports changed rates as a success, with the SKUs Workbench could not take", () => {
    const notice = workbenchSalesRateNotice(
      { ...salesRateBase, status: "succeeded", sent: 6_500, changed: 1_200, unknownSkuCount: 190, draftSkuCount: 10 },
      en,
    );

    expect(notice).toEqual({
      level: "success",
      message: "Workbench sales rates updated",
      description: "6,500 sent · 1,200 changed · 200 SKUs missing or draft in Workbench",
    });
  });

  it("is only informational when no rate changed", () => {
    expect(workbenchSalesRateNotice({ ...salesRateBase, status: "succeeded", sent: 10 }, ko)).toEqual({
      level: "info",
      message: "Workbench: 바뀐 판매율 없음",
      description: "전송 10 · 변경 0",
    });
  });

  it("warns about a partial push and points to Sync History", () => {
    const notice = workbenchSalesRateNotice({ ...salesRateBase, status: "partial", sent: 1_000, changed: 5, failed: 1_000 }, en);

    expect(notice?.level).toBe("warning");
    expect(notice?.description).toBe("1,000 sent · 5 changed · 1,000 failed. See Sync History for details.");
  });

  it("shows the first error of a failed push", () => {
    const notice = workbenchSalesRateNotice(
      { ...salesRateBase, status: "failed", failed: 6_700, errors: ["Workbench POST /x → 401: Unauthorized"] },
      en,
    );

    expect(notice).toEqual({
      level: "error",
      message: "Workbench sales rate push failed",
      description: "Workbench POST /x → 401: Unauthorized",
    });
  });

  it("warns when the push was skipped for another reason", () => {
    expect(workbenchSalesRateNotice({ status: "skipped", reason: "Workbench sales rate push crashed: boom" }, en)).toEqual({
      level: "warning",
      message: "Workbench sales rate push skipped",
      description: "Workbench sales rate push crashed: boom",
    });
  });
});
