import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import type { SensorStateEvent } from '../types';

type StateChangeHandler = (event: SensorStateEvent) => void;

interface WsContextValue {
  on: (handler: StateChangeHandler) => () => void;
}

const WsContext = createContext<WsContextValue | null>(null);

export function WsProvider({ children, token }: { children: ReactNode; token: string | null }) {
  const socketRef = useRef<Socket | null>(null);
  const handlersRef = useRef<Set<StateChangeHandler>>(new Set());

  useEffect(() => {
    if (!token) return;

    const socket = io('/', {
      auth: { token },
      transports: ['websocket'],
      path: '/socket.io',
    });

    socketRef.current = socket;

    socket.on('sensor_state_change', (event: SensorStateEvent) => {
      handlersRef.current.forEach((h) => h(event));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  const on = (handler: StateChangeHandler) => {
    handlersRef.current.add(handler);
    return () => handlersRef.current.delete(handler);
  };

  return <WsContext.Provider value={{ on }}>{children}</WsContext.Provider>;
}

export function useWs() {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error('useWs must be used within WsProvider');
  return ctx;
}
