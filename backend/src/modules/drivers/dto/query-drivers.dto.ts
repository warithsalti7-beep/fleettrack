import { IsBoolean, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { DriverStatus } from '@prisma/client';

export class QueryDriversDto {
  @IsEnum(DriverStatus)
  @IsOptional()
  status?: DriverStatus;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  isOnline?: boolean;

  @IsInt()
  @IsOptional()
  @Min(1)
  page?: number = 1;

  @IsInt()
  @IsOptional()
  @Min(1) @Max(100)
  limit?: number = 50;
}
