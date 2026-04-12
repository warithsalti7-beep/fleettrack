/**
 * IntelligenceEventBus — lightweight RxJS-based event bus.
 *
 * Replaces a full @nestjs/event-emitter setup without adding a new package.
 * Published by telematics-sync.processor and trips.service;
 * consumed by IntelligenceService to trigger partial recomputation.
 *
 * Design: exported from IntelligenceModule so other modules only need to
 * import IntelligenceModule to get access to the bus — no circular deps.
 */

import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';

// ─── Payload types ────────────────────────────────────────────────────────────

export interface TelemetryReceivedEvent {
  vehicleId: string;
  timestamp: Date;
}

export interface TripCompletedEvent {
  tripId: string;
  vehicleId: string;
  driverId: string;
}

// ─── Bus ─────────────────────────────────────────────────────────────────────

@Injectable()
export class IntelligenceEventBus implements OnModuleDestroy {
  private readonly telemetry$ = new Subject<TelemetryReceivedEvent>();
  private readonly tripCompleted$ = new Subject<TripCompletedEvent>();

  // ── Publishers ────────────────────────────────────────────────────────────

  emitTelemetryReceived(event: TelemetryReceivedEvent): void {
    this.telemetry$.next(event);
  }

  emitTripCompleted(event: TripCompletedEvent): void {
    this.tripCompleted$.next(event);
  }

  // ── Observables (for subscribers) ─────────────────────────────────────────

  get telemetryReceived$(): Observable<TelemetryReceivedEvent> {
    return this.telemetry$.asObservable();
  }

  get tripCompleted$(): Observable<TripCompletedEvent> {
    return this.tripCompleted$.asObservable();
  }

  onModuleDestroy(): void {
    this.telemetry$.complete();
    this.tripCompleted$.complete();
  }
}
