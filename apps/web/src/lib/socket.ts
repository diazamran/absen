import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getToken } from './api';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io('/', {
      autoConnect: true,
      transports: ['websocket', 'polling'],
      auth: (cb) => cb({ token: getToken() }),
    });
  }
  return socket;
}

export function useSocketEvent<T = unknown>(event: string, handler: (data: T) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const s = getSocket();
    const fn = (data: T) => ref.current(data);
    s.on(event, fn);
    return () => {
      s.off(event, fn);
    };
  }, [event]);
}

export function joinDashboard(): void {
  getSocket().emit('join:dashboard');
}

export function joinUserRoom(userId: string): void {
  getSocket().emit('join:user', userId);
}
