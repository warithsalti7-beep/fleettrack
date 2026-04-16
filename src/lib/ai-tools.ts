/**
 * Tool registry for the assistant.
 *
 * Each tool is either READ (runs immediately) or WRITE (parks a
 * PendingAction and returns a preview; a second user turn confirms it).
 * The executor (runTool) enforces that split — the LLM never has a
 * direct write path.
 *
 * Rough shape:
 *   1. LLM emits tool_use { name, input }
 *   2. runTool() dispatches:
 *        - READ  → executes, returns JSON string for tool_result
 *        - WRITE → stores PendingAction, returns preview
 *   3. User says "yes"/"confirm" → route calls confirmPendingAction()
 *      which actually mutates the DB.
 */

import { prisma } from "./prisma";
import type { ClaudeToolDef } from "./anthropic";
import type { Principal } from "./ai-memory";

export type ToolKind = "read" | "write";

type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>;

type ToolDef = {
  def: ClaudeToolDef;
  kind: ToolKind;
  handler: ToolHandler;
  /** Human-readable summary used when parking a WRITE as PendingAction. */
  preview?: (input: Record<string, unknown>) => string;
};

// -------------------- READ tools -----------------------------------------

const readFleetStatus: ToolDef = {
  kind: "read",
  def: {
    name: "read_fleet_status",
    description:
      "Return a compact snapshot of the whole fleet: counts of vehicles/drivers, totals for trips/revenue/fuel, pending maintenance. Use this when the user asks anything about overall fleet health.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  handler: async () => {
    const [vehicles, drivers, trips, fuel, pendingMaint] = await Promise.all([
      prisma.vehicle.count(),
      prisma.driver.count(),
      prisma.trip.aggregate({
        _count: true,
        _sum: { fare: true, distance: true },
        _avg: { rating: true },
      }),
      prisma.fuelLog.aggregate({ _sum: { totalCost: true, liters: true } }),
      prisma.maintenance.count({
        where: { status: { in: ["SCHEDULED", "IN_PROGRESS"] } },
      }),
    ]);
    return {
      vehicles,
      drivers,
      trips: {
        total: trips._count,
        revenueNok: Math.round(Number(trips._sum.fare ?? 0)),
        distanceKm: Math.round(Number(trips._sum.distance ?? 0)),
        avgRating: trips._avg.rating,
      },
      fuelSpendNok: Math.round(Number(fuel._sum.totalCost ?? 0)),
      fuelLiters: Math.round(Number(fuel._sum.liters ?? 0)),
      pendingMaintenance: pendingMaint,
    };
  },
};

const findVehicle: ToolDef = {
  kind: "read",
  def: {
    name: "find_vehicle",
    description:
      "Look up a vehicle by plate number or internal carId (e.g. TR2518). Returns status, fuel, mileage, assigned driver, next service.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "plate number or carId" },
      },
      required: ["query"],
    },
  },
  handler: async (input) => {
    const q = String(input.query).trim();
    const v = await prisma.vehicle.findFirst({
      where: { OR: [{ plateNumber: q }, { carId: q }] },
      include: {
        drivers: {
          take: 1,
          orderBy: { assignedAt: "desc" },
          include: { driver: { select: { id: true, name: true, phone: true } } },
        },
        _count: { select: { trips: true, maintenance: true } },
      },
    });
    if (!v) return { found: false, query: q };
    return {
      found: true,
      id: v.id,
      carId: v.carId,
      plateNumber: v.plateNumber,
      make: v.make,
      model: v.model,
      year: v.year,
      status: v.status,
      fuelLevel: v.fuelLevel,
      mileage: v.mileage,
      nextService: v.nextService,
      lastService: v.lastService,
      currentDriver: v.drivers[0]?.driver ?? null,
      totalTrips: v._count.trips,
      totalMaintenance: v._count.maintenance,
    };
  },
};

const findDriver: ToolDef = {
  kind: "read",
  def: {
    name: "find_driver",
    description:
      "Look up a driver by name, email, or phone. Returns status, rating, current vehicle, licence expiry.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  handler: async (input) => {
    const q = String(input.query).trim();
    const d = await prisma.driver.findFirst({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { equals: q, mode: "insensitive" } },
          { phone: { contains: q } },
        ],
      },
      include: {
        vehicles: {
          take: 1,
          orderBy: { assignedAt: "desc" },
          include: { vehicle: { select: { id: true, plateNumber: true, carId: true } } },
        },
        _count: { select: { trips: true } },
      },
    });
    if (!d) return { found: false, query: q };
    return {
      found: true,
      id: d.id,
      name: d.name,
      email: d.email,
      phone: d.phone,
      status: d.status,
      rating: d.rating,
      licenceExpiry: d.licenseExpiry,
      currentVehicle: d.vehicles[0]?.vehicle ?? null,
      totalTrips: d._count.trips,
    };
  },
};

const listUpcomingMaintenance: ToolDef = {
  kind: "read",
  def: {
    name: "list_upcoming_maintenance",
    description:
      "List scheduled or in-progress maintenance jobs in the next N days (default 14). Returns up to 20 rows.",
    input_schema: {
      type: "object",
      properties: { days: { type: "integer", minimum: 1, maximum: 90 } },
    },
  },
  handler: async (input) => {
    const days = Number(input.days ?? 14);
    const until = new Date(Date.now() + days * 24 * 3600 * 1000);
    const rows = await prisma.maintenance.findMany({
      where: {
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        scheduledAt: { lte: until },
      },
      orderBy: { scheduledAt: "asc" },
      take: 20,
      include: {
        vehicle: { select: { plateNumber: true, carId: true } },
      },
    });
    return rows.map((m) => ({
      id: m.id,
      type: m.type,
      priority: m.priority,
      status: m.status,
      scheduledAt: m.scheduledAt,
      costNok: m.cost,
      vehicle: m.vehicle,
    }));
  },
};

const listLicenceExpiries: ToolDef = {
  kind: "read",
  def: {
    name: "list_licence_expiries",
    description:
      "List drivers whose licence expires within N days. Use for daily compliance checks.",
    input_schema: {
      type: "object",
      properties: { days: { type: "integer", minimum: 1, maximum: 365 } },
    },
  },
  handler: async (input) => {
    const days = Number(input.days ?? 30);
    const until = new Date(Date.now() + days * 24 * 3600 * 1000);
    const rows = await prisma.driver.findMany({
      where: { licenseExpiry: { lte: until } },
      orderBy: { licenseExpiry: "asc" },
      take: 50,
      select: { id: true, name: true, email: true, licenseExpiry: true, status: true },
    });
    return rows;
  },
};

const recentTrips: ToolDef = {
  kind: "read",
  def: {
    name: "recent_trips",
    description:
      "Return the most recent N trips (default 10). Optionally filter by driverId or vehicleId.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 50 },
        driverId: { type: "string" },
        vehicleId: { type: "string" },
      },
    },
  },
  handler: async (input) => {
    const rows = await prisma.trip.findMany({
      where: {
        driverId: input.driverId ? String(input.driverId) : undefined,
        vehicleId: input.vehicleId ? String(input.vehicleId) : undefined,
      },
      orderBy: { createdAt: "desc" },
      take: Number(input.limit ?? 10),
      include: {
        driver: { select: { name: true } },
        vehicle: { select: { plateNumber: true, carId: true } },
      },
    });
    return rows;
  },
};

// -------------------- WRITE tools ----------------------------------------

const scheduleMaintenance: ToolDef = {
  kind: "write",
  def: {
    name: "schedule_maintenance",
    description:
      "Schedule a new maintenance job on a vehicle. Use plate number or carId for vehicle.",
    input_schema: {
      type: "object",
      properties: {
        vehicle: { type: "string", description: "plate number or carId" },
        type: { type: "string", description: "e.g. OIL_CHANGE, BRAKES, TYRES, SERVICE" },
        description: { type: "string" },
        scheduledAt: { type: "string", description: "ISO date" },
        priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"] },
        costNok: { type: "number" },
      },
      required: ["vehicle", "type", "description", "scheduledAt"],
    },
  },
  preview: (i) =>
    `Schedule ${i.type} on ${i.vehicle} for ${i.scheduledAt} — ${i.description}${
      i.costNok ? ` (~${i.costNok} NOK)` : ""
    }`,
  handler: async (input) => {
    const vehicle = await prisma.vehicle.findFirst({
      where: {
        OR: [{ plateNumber: String(input.vehicle) }, { carId: String(input.vehicle) }],
      },
    });
    if (!vehicle) throw new Error(`Vehicle ${input.vehicle} not found`);
    return prisma.maintenance.create({
      data: {
        vehicleId: vehicle.id,
        type: String(input.type),
        description: String(input.description),
        scheduledAt: new Date(String(input.scheduledAt)),
        priority: String(input.priority ?? "NORMAL"),
        cost: input.costNok != null ? Number(input.costNok) : null,
      },
    });
  },
};

const updateVehicleStatus: ToolDef = {
  kind: "write",
  def: {
    name: "update_vehicle_status",
    description:
      "Change a vehicle's operational status (AVAILABLE, IN_USE, MAINTENANCE, OUT_OF_SERVICE).",
    input_schema: {
      type: "object",
      properties: {
        vehicle: { type: "string" },
        status: {
          type: "string",
          enum: ["AVAILABLE", "IN_USE", "MAINTENANCE", "OUT_OF_SERVICE"],
        },
      },
      required: ["vehicle", "status"],
    },
  },
  preview: (i) => `Set ${i.vehicle} → status ${i.status}`,
  handler: async (input) => {
    const vehicle = await prisma.vehicle.findFirst({
      where: {
        OR: [{ plateNumber: String(input.vehicle) }, { carId: String(input.vehicle) }],
      },
    });
    if (!vehicle) throw new Error(`Vehicle ${input.vehicle} not found`);
    return prisma.vehicle.update({
      where: { id: vehicle.id },
      data: { status: String(input.status) },
    });
  },
};

const assignDriverToVehicle: ToolDef = {
  kind: "write",
  def: {
    name: "assign_driver_to_vehicle",
    description: "Assign a driver (by name or email) to a vehicle (by plate or carId).",
    input_schema: {
      type: "object",
      properties: {
        driver: { type: "string" },
        vehicle: { type: "string" },
      },
      required: ["driver", "vehicle"],
    },
  },
  preview: (i) => `Assign driver "${i.driver}" to vehicle ${i.vehicle}`,
  handler: async (input) => {
    const [driver, vehicle] = await Promise.all([
      prisma.driver.findFirst({
        where: {
          OR: [
            { name: { contains: String(input.driver), mode: "insensitive" } },
            { email: { equals: String(input.driver), mode: "insensitive" } },
          ],
        },
      }),
      prisma.vehicle.findFirst({
        where: {
          OR: [
            { plateNumber: String(input.vehicle) },
            { carId: String(input.vehicle) },
          ],
        },
      }),
    ]);
    if (!driver) throw new Error(`Driver ${input.driver} not found`);
    if (!vehicle) throw new Error(`Vehicle ${input.vehicle} not found`);
    return prisma.driverVehicle.create({
      data: { driverId: driver.id, vehicleId: vehicle.id },
    });
  },
};

const logFuelFill: ToolDef = {
  kind: "write",
  def: {
    name: "log_fuel_fill",
    description: "Log a fuel refill for a vehicle.",
    input_schema: {
      type: "object",
      properties: {
        vehicle: { type: "string" },
        liters: { type: "number" },
        pricePerLiterNok: { type: "number" },
        mileageAtFill: { type: "integer" },
        station: { type: "string" },
      },
      required: ["vehicle", "liters", "pricePerLiterNok", "mileageAtFill"],
    },
  },
  preview: (i) =>
    `Log ${i.liters} L @ ${i.pricePerLiterNok} NOK/L on ${i.vehicle} (odo ${i.mileageAtFill})`,
  handler: async (input) => {
    const vehicle = await prisma.vehicle.findFirst({
      where: {
        OR: [{ plateNumber: String(input.vehicle) }, { carId: String(input.vehicle) }],
      },
    });
    if (!vehicle) throw new Error(`Vehicle ${input.vehicle} not found`);
    const liters = Number(input.liters);
    const price = Number(input.pricePerLiterNok);
    return prisma.fuelLog.create({
      data: {
        vehicleId: vehicle.id,
        liters,
        pricePerLiter: price,
        totalCost: Math.round(liters * price * 100) / 100,
        mileageAtFill: Number(input.mileageAtFill),
        station: input.station ? String(input.station) : null,
      },
    });
  },
};

const addFixedCost: ToolDef = {
  kind: "write",
  def: {
    name: "add_fixed_cost",
    description:
      "Add a recurring or one-off fixed cost. Leave vehicle empty for fleet-wide costs.",
    input_schema: {
      type: "object",
      properties: {
        vehicle: { type: "string", description: "optional plate or carId" },
        category: {
          type: "string",
          enum: [
            "LEASE",
            "INSURANCE",
            "FINANCING",
            "PARKING",
            "WASH",
            "LOYVE",
            "TAXIMETER",
            "REGISTRATION",
            "DEPRECIATION",
            "OFFICE",
            "SOFTWARE",
            "SALARY",
            "EMPLOYER_NI",
            "ACCOUNTING",
            "OTHER",
          ],
        },
        description: { type: "string" },
        amountNok: { type: "number" },
        frequency: {
          type: "string",
          enum: ["ONCE", "MONTHLY", "QUARTERLY", "YEARLY"],
        },
        startDate: { type: "string", description: "ISO date" },
        vendor: { type: "string" },
      },
      required: ["category", "description", "amountNok", "startDate"],
    },
  },
  preview: (i) =>
    `Add ${i.frequency ?? "MONTHLY"} ${i.category} "${i.description}" ${i.amountNok} NOK` +
    (i.vehicle ? ` on ${i.vehicle}` : " (fleet-wide)"),
  handler: async (input) => {
    let vehicleId: string | null = null;
    if (input.vehicle) {
      const v = await prisma.vehicle.findFirst({
        where: {
          OR: [
            { plateNumber: String(input.vehicle) },
            { carId: String(input.vehicle) },
          ],
        },
      });
      if (!v) throw new Error(`Vehicle ${input.vehicle} not found`);
      vehicleId = v.id;
    }
    return prisma.fixedCost.create({
      data: {
        vehicleId,
        category: String(input.category),
        description: String(input.description),
        amountNok: Number(input.amountNok),
        frequency: String(input.frequency ?? "MONTHLY"),
        startDate: new Date(String(input.startDate)),
        vendor: input.vendor ? String(input.vendor) : null,
      },
    });
  },
};

const saveMemory: ToolDef = {
  kind: "read", // saving a preference is not a DB mutation of fleet data; runs immediately
  def: {
    name: "save_memory",
    description:
      "Persist a durable fact about the current user so future sessions remember it. Use for preferences, focus areas, reporting cadence. Do NOT use for one-off queries.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "snake_case identifier" },
        value: { type: "string" },
      },
      required: ["key", "value"],
    },
  },
  handler: async () => ({ ok: true }), // actual write happens in the route where principal is known
};

// -------------------- Registry -------------------------------------------

const REGISTRY: Record<string, ToolDef> = {
  [readFleetStatus.def.name]: readFleetStatus,
  [findVehicle.def.name]: findVehicle,
  [findDriver.def.name]: findDriver,
  [listUpcomingMaintenance.def.name]: listUpcomingMaintenance,
  [listLicenceExpiries.def.name]: listLicenceExpiries,
  [recentTrips.def.name]: recentTrips,
  [scheduleMaintenance.def.name]: scheduleMaintenance,
  [updateVehicleStatus.def.name]: updateVehicleStatus,
  [assignDriverToVehicle.def.name]: assignDriverToVehicle,
  [logFuelFill.def.name]: logFuelFill,
  [addFixedCost.def.name]: addFixedCost,
  [saveMemory.def.name]: saveMemory,
};

export function toolDefinitions(allowWrites: boolean): ClaudeToolDef[] {
  return Object.values(REGISTRY)
    .filter((t) => allowWrites || t.kind === "read")
    .map((t) => t.def);
}

export type RunToolResult =
  | { type: "result"; output: unknown }
  | { type: "pending"; pendingId: string; summary: string }
  | { type: "error"; message: string };

const PENDING_TTL_MS = 10 * 60 * 1000;

/**
 * Dispatch a tool_use block.
 *   - READ tools execute inline.
 *   - WRITE tools park as PendingAction and return a human preview; the
 *     caller must call confirmPendingAction() when the user confirms.
 */
export async function runTool(
  principal: Principal,
  name: string,
  input: Record<string, unknown>,
  opts: { allowWrites: boolean },
): Promise<RunToolResult> {
  const tool = REGISTRY[name];
  if (!tool) return { type: "error", message: `Unknown tool: ${name}` };

  if (tool.kind === "write") {
    if (!opts.allowWrites) {
      return { type: "error", message: `Write tool ${name} is not allowed in this context.` };
    }
    const summary = tool.preview?.(input) ?? `Run ${name}`;
    const pending = await prisma.pendingAction.create({
      data: {
        principal,
        tool: name,
        input: input as object,
        summary,
        expiresAt: new Date(Date.now() + PENDING_TTL_MS),
      },
    });
    return { type: "pending", pendingId: pending.id, summary };
  }

  try {
    const output = await tool.handler(input);
    return { type: "result", output };
  } catch (err) {
    return {
      type: "error",
      message: err instanceof Error ? err.message : "Tool failed",
    };
  }
}

export async function confirmPendingAction(
  principal: Principal,
): Promise<
  | { ok: true; tool: string; summary: string; result: unknown }
  | { ok: false; message: string }
> {
  const pending = await prisma.pendingAction.findFirst({
    where: { principal, status: "pending" },
    orderBy: { createdAt: "desc" },
  });
  if (!pending) return { ok: false, message: "No pending action to confirm." };
  if (pending.expiresAt.getTime() < Date.now()) {
    await prisma.pendingAction.update({
      where: { id: pending.id },
      data: { status: "expired" },
    });
    return { ok: false, message: "That action expired. Please re-issue the request." };
  }
  const tool = REGISTRY[pending.tool];
  if (!tool) return { ok: false, message: `Tool ${pending.tool} no longer exists.` };
  try {
    const result = await tool.handler(pending.input as Record<string, unknown>);
    await prisma.pendingAction.update({
      where: { id: pending.id },
      data: { status: "confirmed" },
    });
    return { ok: true, tool: pending.tool, summary: pending.summary, result };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Execution failed",
    };
  }
}

export async function cancelPendingAction(principal: Principal): Promise<boolean> {
  const res = await prisma.pendingAction.updateMany({
    where: { principal, status: "pending" },
    data: { status: "cancelled" },
  });
  return res.count > 0;
}

export async function currentPendingSummary(
  principal: Principal,
): Promise<string | null> {
  const p = await prisma.pendingAction.findFirst({
    where: { principal, status: "pending", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  return p?.summary ?? null;
}
