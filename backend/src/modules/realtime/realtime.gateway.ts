/**
 * RealtimeGateway — WebSocket server for live fleet updates.
 *
 * Clients connect and subscribe to rooms:
 *   - 'fleet-updates'   → broadcast vehicle location/status
 *   - 'trip:<id>'       → subscribe to specific trip updates
 *   - 'driver:<id>'     → subscribe to specific driver status
 *
 * Events emitted by server:
 *   - vehicle:location  → { vehicleId, lat, lng, speedKmh, heading, ts }
 *   - vehicle:status    → { vehicleId, status, batteryLevel, fuelLevel }
 *   - vehicle:charging  → { vehicleId, isCharging, chargingPower, batteryLevel }
 *   - driver:status     → { driverId, status, isOnline, locationLat, locationLng }
 *   - trip:update       → { tripId, status, driverId, vehicleId }
 *   - fleet:stats       → { onlineDrivers, activeTrips, availableVehicles }
 */

import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit,
  MessageBody, ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

interface VehicleLocationPayload {
  vehicleId: string;
  lat: number;
  lng: number;
  speedKmh?: number;
  heading?: number;
  batteryLevel?: number;
  fuelLevel?: number;
  isCharging?: boolean;
  ts: string;
}

interface DriverStatusPayload {
  driverId: string;
  status: string;
  isOnline: boolean;
  lat?: number;
  lng?: number;
  ts: string;
}

interface TripUpdatePayload {
  tripId: string;
  status: string;
  driverId: string;
  vehicleId: string;
  ts: string;
}

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  },
  namespace: '/',
  transports: ['websocket', 'polling'],
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  private connectedClients = new Map<string, Socket>();

  afterInit(server: Server) {
    this.logger.log('WebSocket gateway initialized');
  }

  handleConnection(client: Socket) {
    this.connectedClients.set(client.id, client);
    this.logger.log(`Client connected: ${client.id} (total: ${this.connectedClients.size})`);
  }

  handleDisconnect(client: Socket) {
    this.connectedClients.delete(client.id);
    this.logger.log(`Client disconnected: ${client.id} (total: ${this.connectedClients.size})`);
  }

  // ─── Client-initiated room subscriptions ──────────────────────────────────

  @SubscribeMessage('subscribe:fleet')
  handleSubscribeFleet(@ConnectedSocket() client: Socket) {
    client.join('fleet-updates');
    client.emit('subscribed', { room: 'fleet-updates' });
    this.logger.debug(`${client.id} joined fleet-updates`);
  }

  @SubscribeMessage('subscribe:trip')
  handleSubscribeTrip(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { tripId: string },
  ) {
    client.join(`trip:${data.tripId}`);
    client.emit('subscribed', { room: `trip:${data.tripId}` });
  }

  @SubscribeMessage('subscribe:driver')
  handleSubscribeDriver(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { driverId: string },
  ) {
    client.join(`driver:${data.driverId}`);
    client.emit('subscribed', { room: `driver:${data.driverId}` });
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket) {
    client.emit('pong', { ts: new Date().toISOString() });
  }

  // ─── Server-initiated broadcasts (called by services) ─────────────────────

  /**
   * Broadcast vehicle location update to all subscribers.
   * Called by TelematicsSyncProcessor after each poll.
   */
  emitVehicleLocation(payload: VehicleLocationPayload) {
    this.server.to('fleet-updates').emit('vehicle:location', payload);
  }

  /**
   * Broadcast vehicle status change (charging, available, on_trip, etc.)
   */
  emitVehicleStatus(payload: { vehicleId: string; status: string; batteryLevel?: number; fuelLevel?: number }) {
    this.server.to('fleet-updates').emit('vehicle:status', payload);
  }

  /**
   * Broadcast charging event.
   */
  emitVehicleCharging(payload: { vehicleId: string; isCharging: boolean; chargingPower?: number; batteryLevel?: number }) {
    this.server.to('fleet-updates').emit('vehicle:charging', payload);
  }

  /**
   * Broadcast driver status change.
   */
  emitDriverStatus(payload: DriverStatusPayload) {
    this.server.to('fleet-updates').emit('driver:status', payload);
    this.server.to(`driver:${payload.driverId}`).emit('driver:status', payload);
  }

  /**
   * Broadcast trip lifecycle update.
   */
  emitTripUpdate(payload: TripUpdatePayload) {
    this.server.to('fleet-updates').emit('trip:update', payload);
    this.server.to(`trip:${payload.tripId}`).emit('trip:update', payload);
    this.server.to(`driver:${payload.driverId}`).emit('trip:update', payload);
  }

  /**
   * Broadcast fleet-wide stats (e.g. every 30s from a cron job).
   */
  emitFleetStats(stats: {
    onlineDrivers: number;
    activeTrips: number;
    availableVehicles: number;
    chargingVehicles: number;
  }) {
    this.server.to('fleet-updates').emit('fleet:stats', { ...stats, ts: new Date().toISOString() });
  }

  get clientCount() {
    return this.connectedClients.size;
  }
}
