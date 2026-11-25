'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL, decodeToken, tokenStore, type Principal } from './api';

interface Session {
  principal: Principal | null;
  ready: boolean;
  signIn: (token: string) => void;
  signOut: () => void;
  socket: Socket | null;
}
const Ctx = createContext<Session>({ principal: null, ready: false, signIn: () => {}, signOut: () => {}, socket: null });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [ready, setReady] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    setPrincipal(decodeToken(tokenStore.get()));
    setReady(true);
  }, []);

  // One live connection per signed-in session; the server decides which events this user may see.
  useEffect(() => {
    const token = tokenStore.get();
    if (!principal || !token) return;
    const s = io(API_URL, { auth: { token }, transports: ['websocket'] });
    setSocket(s);
    return () => {
      s.disconnect();
      setSocket(null);
    };
  }, [principal]);

  const signIn = useCallback((token: string) => {
    tokenStore.set(token);
    setPrincipal(decodeToken(token));
  }, []);
  const signOut = useCallback(() => {
    tokenStore.clear();
    setPrincipal(null);
    window.location.href = '/login';
  }, []);
  return <Ctx.Provider value={{ principal, ready, signIn, signOut, socket }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
