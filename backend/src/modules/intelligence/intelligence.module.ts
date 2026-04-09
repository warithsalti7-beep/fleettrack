import { Module } from '@nestjs/common';
import { IntelligenceController } from './intelligence.controller';
import { IntelligenceService } from './intelligence.service';
import { IntelligenceScheduler } from './intelligence.scheduler';
import { ScoringService } from './scoring.service';
import { FleetConfigService } from './fleet-config.service';
import { RecommendationsService } from './recommendations.service';
import { IntelligenceEventBus } from './intelligence.events';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [IntelligenceController],
  providers: [
    IntelligenceService,
    ScoringService,
    IntelligenceScheduler,
    FleetConfigService,
    RecommendationsService,
    IntelligenceEventBus,
  ],
  exports: [
    IntelligenceService,
    ScoringService,
    IntelligenceEventBus, // exported so telematics + trips can publish events
  ],
})
export class IntelligenceModule {}
