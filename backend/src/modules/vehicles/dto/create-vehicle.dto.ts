import {
  IsString, IsEnum, IsOptional, IsInt, IsNumber,
  IsBoolean, Min, Max, Length,
} from 'class-validator';
import { VehicleType, FuelType, TelematicsProvider } from '@prisma/client';

export class CreateVehicleDto {
  @IsString()
  @Length(2, 20)
  plateNumber: string;

  @IsString()
  @IsOptional()
  vin?: string;

  @IsString()
  make: string;

  @IsString()
  model: string;

  @IsInt()
  @Min(2000)
  @Max(new Date().getFullYear() + 1)
  year: number;

  @IsString()
  color: string;

  @IsEnum(VehicleType)
  @IsOptional()
  type?: VehicleType;

  @IsEnum(FuelType)
  @IsOptional()
  fuelType?: FuelType;

  @IsNumber()
  @IsOptional()
  @Min(0) @Max(100)
  fuelLevel?: number;

  @IsNumber()
  @IsOptional()
  @Min(0) @Max(100)
  batteryLevel?: number;

  @IsInt()
  @IsOptional()
  @Min(0)
  mileage?: number;

  @IsEnum(TelematicsProvider)
  @IsOptional()
  telematicsProvider?: TelematicsProvider;

  @IsString()
  @IsOptional()
  telematicsVehicleId?: string;

  @IsBoolean()
  @IsOptional()
  telematicsEnabled?: boolean;

  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
