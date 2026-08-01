import { describe, it, expect, vi, beforeEach } from "vitest";
import { ValidationError } from "@/lib/errors";

const repositoryMock = {
  listVehicles: vi.fn(),
  insertVehicle: vi.fn(),
  updateVehicle: vi.fn(),
  syncFromLookup: vi.fn(),
  listDistinctMakes: vi.fn(),
  listDistinctModelsForMake: vi.fn(),
};

vi.mock("@/lib/vehicles/repository", async () => {
  const actual = await vi.importActual<typeof import("@/lib/vehicles/repository")>("@/lib/vehicles/repository");
  return { ...actual, VehiclesRepository: repositoryMock };
});

const { VehiclesService } = await import("@/lib/vehicles/service");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("VehiclesService.createVehicle", () => {
  it("throws ValidationError when f_number/make/model are missing", async () => {
    await expect(VehiclesService.createVehicle({})).rejects.toThrow("f_number is required");
    await expect(VehiclesService.createVehicle({ f_number: "F1" })).rejects.toThrow("make is required");
    await expect(VehiclesService.createVehicle({ f_number: "F1", make: "Toyota" })).rejects.toThrow("model is required");
    expect(repositoryMock.insertVehicle).not.toHaveBeenCalled();
  });

  it("only forwards allowlisted columns, converting empty strings to null", async () => {
    await VehiclesService.createVehicle({ f_number: "F1", make: "Toyota", model: "Camry", model_2: "", bogus: "x" });
    expect(repositoryMock.insertVehicle).toHaveBeenCalledWith(
      ["f_number", "make", "model", "model_2"],
      ["F1", "Toyota", "Camry", null],
    );
  });
});

describe("VehiclesService.updateVehicle", () => {
  it("throws ValidationError when no allowlisted fields are present", async () => {
    await expect(VehiclesService.updateVehicle(1, { bogus: "x" })).rejects.toThrow(ValidationError);
    expect(repositoryMock.updateVehicle).not.toHaveBeenCalled();
  });

  it("builds set clauses for provided fields plus updated_at, appending id last", async () => {
    await VehiclesService.updateVehicle(5, { make: "Honda", model_2: "" });
    expect(repositoryMock.updateVehicle).toHaveBeenCalledWith(
      5,
      ["make = $1", "model_2 = $2", "updated_at = NOW()"],
      ["Honda", null, 5],
    );
  });
});

describe("VehiclesService.sync", () => {
  it("delegates to the repository", async () => {
    repositoryMock.syncFromLookup.mockResolvedValue({ upserted: 3, deleted: 1 });
    const result = await VehiclesService.sync();
    expect(result).toEqual({ upserted: 3, deleted: 1 });
  });
});

describe("VehiclesService.vehicleOptions", () => {
  it("lists distinct makes when no make is given", async () => {
    repositoryMock.listDistinctMakes.mockResolvedValue(["Honda", "Toyota"]);
    const result = await VehiclesService.vehicleOptions(null);
    expect(result).toEqual(["Honda", "Toyota"]);
    expect(repositoryMock.listDistinctModelsForMake).not.toHaveBeenCalled();
  });

  it("lists distinct models for the given make", async () => {
    repositoryMock.listDistinctModelsForMake.mockResolvedValue(["Camry", "Corolla"]);
    const result = await VehiclesService.vehicleOptions("Toyota");
    expect(result).toEqual(["Camry", "Corolla"]);
    expect(repositoryMock.listDistinctModelsForMake).toHaveBeenCalledWith("Toyota");
  });
});
