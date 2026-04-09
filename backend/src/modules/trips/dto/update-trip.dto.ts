import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsNumber, IsOptional, Min, Max } from 'class-validator';
import { PaymentMethod } from '@prisma/client';
import { CreateTripDto } from './create-trip.dto';

export class UpdateTripDto extends PartialType(CreateTripDto) {
  @IsNumber()
  @IsOptional()
  @Min(0)
  fare?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  distanceKm?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  durationMin?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(5)
  driverRating?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(5)
  passengerRating?: number;

  @IsEnum(PaymentMethod)
  @IsOptional()
  paymentMethod?: PaymentMethod;

  @IsNumber()
  @IsOptional()
  @Min(0)
  tipAmount?: number;
}
