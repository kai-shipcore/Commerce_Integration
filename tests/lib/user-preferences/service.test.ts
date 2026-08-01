import { describe, it, expect, vi, beforeEach } from "vitest";
import { ValidationError } from "@/lib/errors";

const repositoryMock = { getAll: vi.fn(), upsertMany: vi.fn() };
vi.mock("@/lib/user-preferences/repository", () => ({ UserPreferencesRepository: repositoryMock }));

const { UserPreferencesService } = await import("@/lib/user-preferences/service");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("UserPreferencesService.getPreferences", () => {
  it("flattens key/value rows into a single object", async () => {
    repositoryMock.getAll.mockResolvedValue([{ key: "theme", value: "dark" }, { key: "cols", value: ["a", "b"] }]);
    const result = await UserPreferencesService.getPreferences("u1");
    expect(result).toEqual({ theme: "dark", cols: ["a", "b"] });
  });
});

describe("UserPreferencesService.savePreferences", () => {
  it("throws ValidationError for a non-object payload", async () => {
    await expect(UserPreferencesService.savePreferences("u1", "not an object")).rejects.toThrow(ValidationError);
    await expect(UserPreferencesService.savePreferences("u1", null)).rejects.toThrow(ValidationError);
  });

  it("is a no-op for an empty object", async () => {
    await UserPreferencesService.savePreferences("u1", {});
    expect(repositoryMock.upsertMany).not.toHaveBeenCalled();
  });

  it("upserts each entry", async () => {
    await UserPreferencesService.savePreferences("u1", { theme: "dark" });
    expect(repositoryMock.upsertMany).toHaveBeenCalledWith("u1", [["theme", "dark"]]);
  });
});
