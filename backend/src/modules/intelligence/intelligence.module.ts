import { Module } from '@nestjs/common';
import { IntelligenceController } from './intelligence.controller';
import { IntelligenceService } from './intelligence.service';
import { IntelligenceScheduler } from './intelligence.scheduler';
import { ScoringService } from './scoring.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [IntelligenceController],
  providers: [IntelligenceService, ScoringService, IntelligenceScheduler],
  exports: [IntelligenceService, ScoringService],
})
export class IntelligenceModule {}
