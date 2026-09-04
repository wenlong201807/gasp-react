import { io, Socket } from 'socket.io-client';

interface ServerToClientEvents {
  'fps:update': (data: { fps: number; memory: number }) => void;
  'animation:sync': (data: { id: string; progress: number }) => void;
  'theme:change': (theme: 'light' | 'dark') => void;
}

interface ClientToServerEvents {
  'fps:report': (data: { fps: number }) => void;
  'page:view': (data: { url: string }) => void;
}

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const socket: AppSocket = io(
  import.meta.env.VITE_SOCKET_URL || 'ws://localhost:3001',
  {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  }
);
