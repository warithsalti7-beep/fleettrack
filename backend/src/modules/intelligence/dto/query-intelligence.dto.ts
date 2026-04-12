import { IsDateString, IsOptional } from 'class-validator';

export class TripInsightsQueryDto {
  /** ISO 8601 date string — start of analysis window (default: 30 days ago) */
  @IsDateString()
  @IsOptional()
  from?: string;

  /** ISO 8601 date string — end of analysis window (default: now) */
  @IsDateString()
  @IsOptional()
  to?: string;
}
