import { describe, it, expect, vi, beforeEach } from "vitest";

const repositoryMock = {
  upsertDailyActivity: vi.fn(),
  insertActivityEvents: vi.fn(),
};

vi.mock("@/lib/user-activity/repository", () => ({ UserActivityRepository: repositoryMock }));
vi.mock("@/lib/activity-date", () => ({
  getActivityDate: () => "2026-07-29",
  activityDateToUtc: (d: string) => new Date(`${d}T00:00:00Z`),
}));

const { UserActivityService } = await import("@/lib/user-activity/service");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("UserActivityService.recordHeartbeat", () => {
  it("passes a trimmed path through", async () => {
    await UserActivityService.recordHeartbeat("u1", "  /home  ");
    expect(repositoryMock.upsertDailyActivity).toHaveBeenCalledWith(
      "u1", new Date("2026-07-29T00:00:00Z"), expect.any(Date), "/home",
    );
  });

  it("defaults a non-string path to null", async () => {
    await UserActivityService.recordHeartbeat("u1", undefined);
    expect(repositoryMock.upsertDailyActivity).toHaveBeenCalledWith(
      "u1", expect.any(Date), expect.any(Date), null,
    );
  });
});

describe("UserActivityService.recordEvents", () => {
  it("drops events with an unrecognized eventType", async () => {
    const recorded = await UserActivityService.recordEvents(
      "u1", [{ eventType: "not_a_real_type" }], "1.2.3.4", "ua",
    );
    expect(recorded).toBe(0);
    expect(repositoryMock.insertActivityEvents).toHaveBeenCalledWith([]);
  });

  it("caps the batch at 50 events", async () => {
    const events = Array.from({ length: 60 }, () => ({ eventType: "page_view" }));
    const recorded = await UserActivityService.recordEvents("u1", events, null, null);
    expect(recorded).toBe(50);
  });

  it("cleans and forwards valid event fields", async () => {
    const recorded = await UserActivityService.recordEvents(
      "u1",
      [{ eventType: "button_click", path: "/a", label: "  save  ", target: "btn", occurredAt: "2026-01-01T00:00:00Z" }],
      "1.2.3.4",
      "  Mozilla/5.0  ",
    );
    expect(recorded).toBe(1);
    expect(repositoryMock.insertActivityEvents).toHaveBeenCalledWith([
      {
        userId: "u1",
        occurredAt: new Date("2026-01-01T00:00:00Z"),
        eventType: "button_click",
        path: "/a",
        label: "save",
        target: "btn",
        ip: "1.2.3.4",
        userAgent: "Mozilla/5.0",
      },
    ]);
  });
});
