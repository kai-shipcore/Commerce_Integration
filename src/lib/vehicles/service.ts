/**
 * Business logic for the Vehicles admin page: field allowlisting/validation
 * for create/update, and the lookup-DB sync pipeline.
 */

import { ValidationError } from "@/lib/errors";
import { VehiclesRepository, VEHICLE_INSERT_COLUMNS, VEHICLE_UPDATE_COLUMNS } from "@/lib/vehicles/repository";

export const VehiclesService = {
  listVehicles(): Promise<Record<string, unknown>[]> {
    return VehiclesRepository.listVehicles();
  },

  async createVehicle(body: Record<string, unknown>): Promise<void> {
    if (!body["f_number"] || String(body["f_number"]).trim() === "") {
      throw new ValidationError("f_number is required");
    }
    if (!body["make"] || String(body["make"]).trim() === "") {
      throw new ValidationError("make is required");
    }
    if (!body["model"] || String(body["model"]).trim() === "") {
      throw new ValidationError("model is required");
    }

    const cols: string[] = [];
    const values: unknown[] = [];
    for (const col of VEHICLE_INSERT_COLUMNS) {
      if (col in body) {
        cols.push(col);
        values.push(body[col] === "" ? null : body[col]);
      }
    }

    await VehiclesRepository.insertVehicle(cols, values);
  },

  async updateVehicle(id: number, body: Record<string, unknown>): Promise<void> {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    for (const col of VEHICLE_UPDATE_COLUMNS) {
      if (col in body) {
        values.push(body[col] === "" ? null : body[col]);
        setClauses.push(`${col} = $${values.length}`);
      }
    }

    if (setClauses.length === 0) {
      throw new ValidationError("No fields to update");
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    await VehiclesRepository.updateVehicle(id, setClauses, values);
  },

  async sync(): Promise<{ upserted: number; deleted: number }> {
    return VehiclesRepository.syncFromLookup();
  },

  vehicleOptions(make: string | null): Promise<string[]> {
    return make ? VehiclesRepository.listDistinctModelsForMake(make) : VehiclesRepository.listDistinctMakes();
  },
};
