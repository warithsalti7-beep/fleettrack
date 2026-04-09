import { IsEnum, IsInt, IsOptional, Min, Max } from 'class-validator';
import { VehicleStatus, VehicleType, TelematicsProvider } from '@prisma/client';

export class QueryVehiclesDto {
  @IsEnum(VehicleStatus)
  @IsOptional()
  status?: VehicleStatus;

  @IsEnum(VehicleType)
  @IsOptional()
  type?: VehicleType;

  @IsEnum(TelematicsProvider)
  @IsOptional()
  telematicsProvider?: TelematicsProvider;

  @IsInt()
  @IsOptional()
  @Min(1)
  page?: number = 1;

  @IsInt()
  @IsOptional()
  @Min(1) @Max(100)
  limit?: number = 50;
}
