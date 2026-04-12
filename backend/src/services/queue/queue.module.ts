import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TelematicsSyncProcessor } from './processors/telematics-sync.processor';
import { VehicleStatusProcessor } from './processors/vehicle-status.processor';
import { TeslaService } from '../tesla/tesla.service';
import { NioService } from '../nio/nio.service';
import { RealtimeModule } from '../../modules/realtime/realtime.module';
import { IntelligenceModule } from '../../modules/intelligence/intelligence.module';

export const QUEUE_NAMES = {
  TELEMATICS_SYNC: 'telematics-sync',
  VEHICLE_STATUS: 'vehicle-status',
} as const;

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_NAMES.TELEMATICS_SYNC },
      { name: QUEUE_NAMES.VEHICLE_STATUS },
    ),
    RealtimeModule,
    IntelligenceModule,
  ],
  providers: [
    TelematicsSyncProcessor,
    VehicleStatusProcessor,
    TeslaService,
    NioService,
  ],
  exports: [BullModule],
})
export class QueueModule {}
