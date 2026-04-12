import {
  Controller, Get, Post, Patch, Delete, Body, Param,
  Query, UseGuards, Version, ParseUUIDPipe,
} from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { QueryVehiclesDto } from './dto/query-vehicles.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

@Controller({ path: 'vehicles', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  /**
   * GET /api/v1/vehicles
   * List vehicles with optional filters (status, type, provider).
   */
  @Get()
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN')
  findAll(@Query() query: QueryVehiclesDto) {
    return this.vehiclesService.findAll(query);
  }

  /**
   * GET /api/v1/vehicles/live
   * Returns all vehicles with live telematics data from Redis cache.
   */
  @Get('live')
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN')
  getLiveStatus() {
    return this.vehiclesService.getLiveStatus();
  }

  /**
   * GET /api/v1/vehicles/:id
   */
  @Get(':id')
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN')
  findOne(@Param('id') id: string) {
    return this.vehiclesService.findOne(id);
  }

  /**
   * POST /api/v1/vehicles
   */
  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  create(@Body() dto: CreateVehicleDto) {
    return this.vehiclesService.create(dto);
  }

  /**
   * PATCH /api/v1/vehicles/:id
   */
  @Patch(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateVehicleDto) {
    return this.vehiclesService.update(id, dto);
  }

  /**
   * PATCH /api/v1/vehicles/:id/location
   * Update vehicle GPS from driver app (fallback if telematics not integrated).
   */
  @Patch(':id/location')
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN', 'DRIVER')
  updateLocation(
    @Param('id') id: string,
    @Body() body: { lat: number; lng: number; speedKmh?: number; heading?: number },
  ) {
    return this.vehiclesService.updateLocation(id, body);
  }

  /**
   * DELETE /api/v1/vehicles/:id
   * Soft delete.
   */
  @Delete(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  remove(@Param('id') id: string) {
    return this.vehiclesService.remove(id);
  }
}
