// Code Guide: CRUD for shipcore.fc_containers (Container Planning's core
// table). GET is also used by Warehouse Management (destination filters) and
// by the Container Timeline page (?view=timeline). PATCH is shared with
// Demand Planning: requests carrying `x-planning-permission-context:
// demand-planning` are checked against demand-planning.edit instead of
// container-planning.edit, and multiplex onto focused sub-contracts for
// status, calendar color, confirmed delivery, details, ETA, ETA LAX/LGB, or
// a full replace of details + items — selected by query params/body shape.

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { canDo, guardPermission } from "@/lib/permissions";
import { apiSuccess, apiError, handleApiError } from "@/lib/api-response";
import { z } from "zod";
import { ContainerPlanningService } from "@/lib/container-planning/service";

const ContainerStatusSchema = z.enum(["draft", "final-list-sent", "packing-list-received", "complete"]);

const ContainerSaveSchema = z.object({
  number: z.string().trim().min(1),
  eta: z.string().trim().min(1),
  status: ContainerStatusSchema.optional(),
  cbmCapacity: z.number().positive().default(80),
  factory: z.string().trim().optional(),
  origin: z.string().trim().optional(),
  destination: z.string().trim().optional(),
  note: z.string().trim().optional(),
  estLoading: z.string().trim().optional(),
  etdNgb: z.string().trim().optional(),
  etaLaxLgb: z.string().trim().optional(),
  items: z.array(z.object({
    sku: z.string().trim().min(1),
    qty: z.number().int().positive(),
    cbm: z.number().positive(),
    skuMemo: z.string().optional(),
    allocations: z.array(z.unknown()).optional(),
  })).default([]),
});

const ContainerDetailsSchema = z.object({
  number: z.string().trim().min(1),
  eta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cbmCapacity: z.number().positive(),
  factory: z.string().trim().optional(),
  destination: z.string().trim().optional(),
  note: z.string().trim().optional(),
  estLoading: z.string().trim().optional(),
  etdNgb: z.string().trim().optional(),
  etaLaxLgb: z.string().trim().optional(),
}).strict();

const ContainerConfirmedSchema = z.object({
  confirmedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  confirmedTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
}).strict();

const ContainerColorSchema = z.object({
  calendarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
}).strict();

function getRequestIp(request: NextRequest): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const product = searchParams.get("product")?.trim().toLowerCase() ?? "";
    const categoryCode = product === "fm" ? "FM" as const : product === "cc" ? "CC" as const : product === "sc" ? "SC" as const : null;

    const data = await ContainerPlanningService.listContainers({
      warehouseCode: searchParams.get("warehouseCode")?.trim() ?? "",
      warehouseName: searchParams.get("warehouseName")?.trim() ?? "",
      city: searchParams.get("city")?.trim() ?? "",
      includeReceived: searchParams.get("includeReceived") === "true",
      includeDetails: searchParams.get("includeDetails") === "true",
      timelineView: searchParams.get("view") === "timeline",
      categoryCode,
    });

    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();

  try {
    if (session?.user?.id) {
      const allowed = await canDo(session.user.id, (session.user.role as string) ?? "user", "container-planning", "create");
      if (!allowed) return apiError("Permission denied", 403);
    }
    const body: unknown = await request.json();
    const validated = ContainerSaveSchema.parse(body);

    const result = await ContainerPlanningService.createContainer(validated, {
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      ip: getRequestIp(request),
    });

    return apiSuccess({ data: result }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  const ip = getRequestIp(request);
  const demandPlanningRequest = request.headers.get("x-planning-permission-context") === "demand-planning";

  try {
    if (demandPlanningRequest) {
      const denied = await guardPermission("demand-planning", "edit");
      if (denied) return denied;
    }
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id")?.trim();
    const isTimelineDatePatch =
      searchParams.get("confirmedOnly") === "true" ||
      searchParams.get("etaLaxLgbOnly") === "true" ||
      searchParams.get("colorOnly") === "true";

    if (session?.user?.id && !demandPlanningRequest) {
      const role = (session.user.role as string) ?? "user";
      const allowed = isTimelineDatePatch
        ? (await canDo(session.user.id, role, "container-timeline", "edit")) ||
          (await canDo(session.user.id, role, "container-planning", "edit"))
        : await canDo(session.user.id, role, "container-planning", "edit");
      if (!allowed) return apiError("Permission denied", 403);
    }

    if (!id) return apiError("Container id is required", 400);
    if (!/^\d+$/.test(id)) return apiError("Invalid container id", 400);

    const body: unknown = await request.json();
    const detailsOnly = searchParams.get("detailsOnly") === "true";
    const who = { userId: session?.user?.id ?? null, userName: session?.user?.name ?? null, userEmail: session?.user?.email ?? null, ip };

    const existing = await ContainerPlanningService.getExistingOrThrow(id);

    const statusOnly = z.object({ status: ContainerStatusSchema }).strict().safeParse(body);
    if (statusOnly.success) {
      const result = await ContainerPlanningService.updateStatus(id, existing, statusOnly.data.status, who);
      return apiSuccess({ data: result });
    }

    const colorOnly = searchParams.get("colorOnly") === "true"
      ? ContainerColorSchema.safeParse(body)
      : undefined;
    if (colorOnly?.success) {
      const result = await ContainerPlanningService.updateCalendarColor(id, existing, colorOnly.data.calendarColor, who);
      return apiSuccess({ data: result });
    }

    const confirmedOnly = searchParams.get("confirmedOnly") === "true"
      ? ContainerConfirmedSchema.safeParse(body)
      : undefined;
    if (confirmedOnly?.success) {
      const result = await ContainerPlanningService.updateConfirmed(id, existing, confirmedOnly.data.confirmedDate, confirmedOnly.data.confirmedTime, who);
      return apiSuccess({ data: result });
    }

    ContainerPlanningService.assertNotComplete(existing);

    if (detailsOnly) {
      const details = ContainerDetailsSchema.parse(body);
      const result = await ContainerPlanningService.updateDetails(id, existing, details, who);
      return apiSuccess({ data: result });
    }

    const etaOnly = z.object({ eta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict().safeParse(body);
    if (etaOnly.success) {
      const result = await ContainerPlanningService.updateEta(id, existing, etaOnly.data.eta, who);
      return apiSuccess({ data: result });
    }

    const etaLaxLgbOnly = z.object({ etaLaxLgbDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict().safeParse(body);
    if (etaLaxLgbOnly.success) {
      const result = await ContainerPlanningService.updateEtaLaxLgb(id, existing, etaLaxLgbOnly.data.etaLaxLgbDate, who);
      return apiSuccess({ data: result });
    }

    const validated = ContainerSaveSchema.parse(body);
    const result = await ContainerPlanningService.replaceContainer(id, existing, validated, who);
    return apiSuccess({ data: result });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const denied = await guardPermission("container-planning", "delete");
    if (denied) return denied;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id")?.trim();

    if (!id) return apiError("Container id is required", 400);
    if (!/^\d+$/.test(id)) return apiError("Invalid container id", 400);

    const session = await auth();
    const result = await ContainerPlanningService.deleteContainer(id, {
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      ip: getRequestIp(request),
      role: (session?.user?.role as string) ?? null,
    });

    return apiSuccess({ data: result });
  } catch (error) {
    return handleApiError(error);
  }
}
