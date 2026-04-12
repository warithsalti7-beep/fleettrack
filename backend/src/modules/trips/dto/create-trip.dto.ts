import {
  IsString, IsOptional, IsNumber, IsEnum,
  IsLatitude, IsLongitude, Min,
} from 'class-validator';
import { PaymentMethod, TripStatus } from '@prisma/client';

export class CreateTripDto {
  @IsString()
  @IsOptional()
  driverId?: string;

  @IsString()
  @IsOptional()
  vehicleId?: string;

  @IsString()
  pickupAddress: string;

  @IsString()
  dropoffAddress: string;

  @IsNumber()
  @IsLatitude()
  @IsOptional()
  pickupLat?: number;

  @IsNumber()
  @IsLongitude()
  @IsOptional()
  pickupLng?: number;

  @IsNumber()
  @IsLatitude()
  @IsOptional()
  dropoffLat?: number;

  @IsNumber()
  @IsLongitude()
  @IsOptional()
  dropoffLng?: number;

  @IsString()
  @IsOptional()
  passengerName?: string;

  @IsString()
  @IsOptional()
  passengerPhone?: string;

  @IsNumber()
  @IsOptional()
  @Min(1)
  passengerCount?: number;

  @IsEnum(PaymentMethod)
  @IsOptional()
  paymentMethod?: PaymentMethod;

  @IsEnum(TripStatus)
  @IsOptional()
  status?: TripStatus;

  @IsString()
  @IsOptional()
  notes?: string;
}
