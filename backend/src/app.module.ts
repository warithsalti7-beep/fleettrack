import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { CacheModule } from '@nestjs/cache-manager';
import { TerminusModule } from '@nestjs/terminus';
import { redisStore } from 'cache-manager-redis-yet';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { TripsModule } from './modules/trips/trips.module';
import { TelematicsModule } from './modules/telematics/telematics.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { AuthModule } from './modules/auth/auth.module';
import { QueueModule } from './services/queue/queue.module';
import { PrismaModule } from './modules/prisma/prisma.module';

@Module({
  imports: [
    // ─── Config ────────────────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
      envFilePath: ['.env.local', '.env'],
    }),

    // ─── Rate Limiting ─────────────────────────────────────────────────────
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('throttle.ttl', 60) * 1000,
          limit: config.get<number>('throttle.limit', 100),
        },
      ],
    }),

    // ─── Scheduling (cron jobs) ────────────────────────────────────────────
    ScheduleModule.forRoot(),

    // ─── BullMQ (job queues) ───────────────────────────────────────────────
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get<string>('redis.host', 'localhost'),
          port: config.get<number>('redis.port', 6379),
          password: config.get<string>('redis.password') || undefined,
          tls: config.get<boolean>('redis.tls') ? {} : undefined,
        },
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 50,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      }),
    }),

    // ─── Cache (Redis) ─────────────────────────────────────────────────────
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => ({
        store: await redisStore({
          socket: {
            host: config.get<string>('redis.host', 'localhost'),
            port: config.get<number>('redis.port', 6379),
          },
          password: config.get<string>('redis.password') || undefined,
        }),
        ttl: 30_000, // 30 seconds default TTL
      }),
    }),

    // ─── Health Checks ─────────────────────────────────────────────────────
    TerminusModule,

    // ─── Feature Modules ───────────────────────────────────────────────────
    PrismaModule,
    AuthModule,
    VehiclesModule,
    DriversModule,
    TripsModule,
    TelematicsModule,
    RealtimeModule,
    QueueModule,
  ],
})
export class AppModule {}
