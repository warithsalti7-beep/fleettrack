import {
  IsString, IsEmail, IsDateString, IsOptional,
  IsEnum, MinLength, Matches,
} from 'class-validator';
import { DriverStatus } from '@prisma/client';

export class CreateDriverDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @Matches(/^\+?[\d\s\-().]{7,20}$/, { message: 'Invalid phone number' })
  phone: string;

  @IsString()
  licenseNumber: string;

  @IsDateString()
  licenseExpiry: string;

  @IsString()
  @IsOptional()
  licenseClass?: string;

  @IsEnum(DriverStatus)
  @IsOptional()
  status?: DriverStatus;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  photoUrl?: string;

  @IsString()
  @IsOptional()
  emergencyContact?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
