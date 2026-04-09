import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsEnum, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { CreateDriverDto } from './create-driver.dto';
import { DriverStatus } from '@prisma/client';

export class UpdateDriverDto extends PartialType(CreateDriverDto) {
  @IsEnum(DriverStatus)
  @IsOptional()
  status?: DriverStatus;

  @IsNumber()
  @IsOptional()
  @Min(1) @Max(5)
  rating?: number;

  @IsBoolean()
  @IsOptional()
  isOnline?: boolean;
}
