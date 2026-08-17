/**
 * REALTIME (Socket.IO)
 * Singleton emitter — dipasang di server.ts, dipakai oleh service attendance
 * dan modul lain agar dashboard admin/gerbang selalu aktual tanpa reload.
 */
import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { config } from '../config.js';

export interface AttendanceRealtimeEvent {
  id: string;
  type: 'CHECK_IN' | 'CHECK_OUT';
  userId: string;
  fullName: string;
  nis?: string | null;
  className?: string | null;
  time: string; // HH:mm WIB
  status: 'PRESENT' | 'LATE' | 'EXCUSED' | 'SICK' | 'OFFICIAL_DUTY' | 'DISPENSATION' | 'ABSENT' | 'LEAVE';
  method: string;
  lateMinutes: number;
}

let io: SocketIOServer | null = null;

export function initRealtime(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: { origin: config.corsOrigin, methods: ['GET', 'POST'] },
    serveClient: false,
  });

  io.on('connection', (socket) => {
    // Room "dashboard" untuk halaman monitor/statistik admin
    socket.on('join:dashboard', () => socket.join('dashboard'));
    socket.on('join:user', (userId: string) => {
      if (typeof userId === 'string') socket.join(`user:${userId}`);
    });
    socket.on('disconnect', () => {});
  });

  return io;
}

export function emitAttendance(event: AttendanceRealtimeEvent): void {
  io?.to('dashboard').emit('attendance:new', event);
  io?.to(`user:${event.userId}`).emit('attendance:own', event);
}

export function emitNotification(userId: string, notification: unknown): void {
  io?.to(`user:${userId}`).emit('notification:new', notification);
}

export function emitLeaveUpdate(event: unknown): void {
  io?.to('dashboard').emit('leave:updated', event);
}
