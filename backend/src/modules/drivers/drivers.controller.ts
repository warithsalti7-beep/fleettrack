import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { DriversService } from './drivers.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { QueryDriversDto } from './dto/query-drivers.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller({ path: 'drivers', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  @Get()
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN')
  findAll(@Query() query: QueryDriversDto) {
    return this.driversService.findAll(query);
  }

  @Get('online')
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN')
  getOnlineDrivers() {
    return this.driversService.getOnlineDrivers();
  }

  @Get(':id')
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN')
  findOne(@Param('id') id: string) {
    return this.driversService.findOne(id);
  }

  @Get(':id/stats')
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN')
  getStats(@Param('id') id: string) {
    return this.driversService.getDriverStats(id);
  }

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  create(@Body() dto: CreateDriverDto) {
    return this.driversService.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateDriverDto) {
    return this.driversService.update(id, dto);
  }

  /**
   * PATCH /api/v1/drivers/:id/heartbeat
   * Called by driver app every 5–10 seconds to signal online presence.
   * Also updates last-known GPS position.
   */
  @Patch(':id/heartbeat')
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN', 'DRIVER')
  heartbeat(
    @Param('id') id: string,
    @Body() body: { lat?: number; lng?: number },
  ) {
    return this.driversService.heartbeat(id, body.lat, body.lng);
  }

  /**
   * POST /api/v1/drivers/:id/assign-vehicle
   */
  @Post(':id/assign-vehicle')
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN')
  assignVehicle(
    @Param('id') id: string,
    @Body() body: { vehicleId: string },
  ) {
    return this.driversService.assignVehicle(id, body.vehicleId);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  remove(@Param('id') id: string) {
    return this.driversService.remove(id);
  }
}
