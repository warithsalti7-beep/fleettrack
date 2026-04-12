import {
  IsInt, IsNumber, IsObject, IsOptional, Max, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FleetConfig, HealthWeights } from '../intelligence.constants';

export class HealthWeightsDto implements HealthWeights {
  @IsInt() @Min(0) @Max(60) energy: number;
  @IsInt() @Min(0) @Max(40) freshness: number;
  @IsInt() @Min(0) @Max(40) utilization: number;
  @IsInt() @Min(0) @Max(20) diagnostics: number;
  @IsInt() @Min(0) @Max(20) maintenance: number;
}

export class HealthConfigDto {
  @ValidateNested() @Type(() => HealthWeightsDto)
  weights: HealthWeightsDto;

  @IsNumber() @Min(1) @Max(20) obdFaultPenalty: number;
  @IsNumber() @Min(1) @Max(30) maxObdPenalty: number;
}

export class BatteryThresholdsDto {
  @IsNumber() @Min(1) @Max(20)  critical: number;
  @IsNumber() @Min(5) @Max(35)  high: number;
  @IsNumber() @Min(20) @Max(60) medium: number;
  @IsNumber() @Min(40) @Max(90) low: number;
}

export class InactivityConfigDto {
  @IsNumber() @Min(1) @Max(48) vehicleHours: number;
  @IsNumber() @Min(5) @Max(120) telemetryMinutes: number;
}

export class TripEfficiencyConfigDto {
  @IsNumber() @Min(0.1) @Max(5)   minDistanceKm: number;
  @IsNumber() @Min(0.1) @Max(1.0) slowSpeedFactor: number;
  @IsNumber() @Min(5)  @Max(60)   excessiveDurationPerKm: number;
}

export class UpdateFleetConfigDto implements FleetConfig {
  @IsOptional()
  @ValidateNested() @Type(() => HealthConfigDto)
  health: HealthConfigDto;

  @IsOptional()
  @ValidateNested() @Type(() => BatteryThresholdsDto)
  battery: BatteryThresholdsDto;

  @IsOptional()
  @ValidateNested() @Type(() => InactivityConfigDto)
  inactivity: InactivityConfigDto;

  @IsOptional()
  @ValidateNested() @Type(() => TripEfficiencyConfigDto)
  tripEfficiency: TripEfficiencyConfigDto;
}
