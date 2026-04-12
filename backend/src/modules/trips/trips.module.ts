import { Module } from '@nestjs/common';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';
import { MapsService } from '../../services/maps/maps.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { IntelligenceModule } from '../intelligence/intelligence.module';

@Module({
  imports: [RealtimeModule, IntelligenceModule],
  controllers: [TripsController],
  providers: [TripsService, MapsService],
  exports: [TripsService],
})
export class TripsModule {}
