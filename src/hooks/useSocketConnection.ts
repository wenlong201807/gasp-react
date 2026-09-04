import { useEffect } from 'react';
import { socket } from '@/utils/socket';

export function useSocketConnection() {
  useEffect(() => {
    const handleConnect = () => {
      console.log('Socket connected:', socket.id);
      socket.emit('page:view', { url: window.location.href });
    };

    const handleDisconnect = () => {
      console.log('Socket disconnected');
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, []);

  return {
    isConnected: socket.connected,
    socket,
  };
}