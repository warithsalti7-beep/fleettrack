import { Badge } from "./badge";
import {
  driverStatusTone,
  vehicleStatusTone,
  tripStatusTone,
  roleTone,
  humanizeEnum,
  type SemanticTone,
} from "@/lib/format";

/**
 * Status chip wrappers — single place where a raw status string gets
 * translated to a tone + readable label. Consumers just say what the
 * entity is and what status it has; visual consistency is guaranteed.
 */
export function DriverStatusChip({ status }: { status: string }) {
  return <Badge tone={driverStatusTone(status)} mono>{humanizeEnum(status)}</Badge>;
}

export function VehicleStatusChip({ status }: { status: string }) {
  return <Badge tone={vehicleStatusTone(status)} mono>{humanizeEnum(status)}</Badge>;
}

export function TripStatusChip({ status }: { status: string }) {
  return <Badge tone={tripStatusTone(status)} mono>{humanizeEnum(status)}</Badge>;
}

export function RoleChip({ role }: { role: string }) {
  return <Badge tone={roleTone(role)} mono>{role.toUpperCase()}</Badge>;
}

/** Score chip — thresholds: 80+ success, 60+ brand, >0 danger, else neutral. */
export function ScoreChip({ score }: { score: number }) {
  let tone: SemanticTone;
  if (score >= 80) tone = "success";
  else if (score >= 60) tone = "brand";
  else if (score > 0) tone = "danger";
  else tone = "neutral";
  return (
    <Badge tone={tone} mono>
      {score > 0 ? score : "—"}
    </Badge>
  );
}
