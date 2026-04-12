import {
  Controller, Get, Param, Query, UseGuards, ParseIntPipe, DefaultValuePipe,
} from '@nestjs/common';
import { TelematicsService } from './telematics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller({ path: 'telematics', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class TelematicsController {
  constructor(private readonly telematicsService: TelematicsService) {}

  /**
   * GET /api/v1/telematics/fleet/ev-summary
   * EV fleet health: avg battery, low-battery alerts, charging states
   */
  @Get('fleet/ev-summary')
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN')
  getFleetEvSummary() {
    return this.telematicsService.getFleetEvSummary();
  }

  /**
   * GET /api/v1/telematics/fleet/locations
   * Snapshot of all vehicle GPS positions
   */
  @Get('fleet/locations')
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN')
  getFleetLocationSnapshot() {
    return this.telematicsService.getFleetLocationSnapshot();
  }

  /**
   * GET /api/v1/telematics/vehicles/:id/latest
   * Most recent telematics log entry for a vehicle
   */
  @Get('vehicles/:id/latest')
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN', 'DRIVER')
  getLatestLog(@Param('id') id: string) {
    return this.telematicsService.getLatestLog(id);
  }

  /**
   * GET /api/v1/telematics/vehicles/:id/battery-history?hours=24
   * Battery level history for EV range analysis
   */
  @Get('vehicles/:id/battery-history')
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN')
  getBatteryHistory(
    @Param('id') id: string,
    @Query('hours', new DefaultValuePipe(24), ParseIntPipe) hours: number,
  ) {
    return this.telematicsService.getVehicleBatteryHistory(id, hours);
  }

  /**
   * GET /api/v1/telematics/vehicles/:id/logs?from=&to=&limit=100
   * Paginated telematics log entries for a specific vehicle
   */
  @Get('vehicles/:id/logs')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getLogs(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit?: number,
  ) {
    return this.telematicsService.getLogsForVehicle(id, from, to, limit);
  }
}
