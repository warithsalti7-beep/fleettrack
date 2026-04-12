import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { TripsService } from './trips.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { QueryTripsDto } from './dto/query-trips.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller({ path: 'trips', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Get()
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN')
  findAll(@Query() query: QueryTripsDto) {
    return this.tripsService.findAll(query);
  }

  @Get('active')
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN')
  getActiveTrips() {
    return this.tripsService.getActiveTrips();
  }

  @Get('stats')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getStats(@Query('from') from?: string, @Query('to') to?: string) {
    return this.tripsService.getStats(from, to);
  }

  @Get(':id')
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN', 'DRIVER')
  findOne(@Param('id') id: string) {
    return this.tripsService.findOne(id);
  }

  /**
   * POST /api/v1/trips
   * Dispatch a new trip. Auto-calculates fare estimate and route.
   */
  @Post()
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN')
  create(@Body() dto: CreateTripDto) {
    return this.tripsService.create(dto);
  }

  /**
   * PATCH /api/v1/trips/:id/status
   * Advance trip status: PENDING → DRIVER_ASSIGNED → IN_PROGRESS → COMPLETED
   */
  @Patch(':id/status')
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN', 'DRIVER')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string; fare?: number; distanceKm?: number; durationMin?: number },
  ) {
    return this.tripsService.updateStatus(id, body);
  }

  @Patch(':id')
  @Roles('ADMIN', 'DISPATCHER', 'SUPER_ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateTripDto) {
    return this.tripsService.update(id, dto);
  }
}
