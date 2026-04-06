"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export interface LiveChannelData {
  channelId: 0 | 1;
  voltageV: number;
  currentA: number;
  actPowerW: number;
  aprtPowerVA: number;
  reactivePowerVAr: number;
  powerFactor: number;
  frequencyHz: number;
  totalActEnergyKwh: number;
  totalActRetEnergyKwh: number;
}

export interface LiveReadingsEvent {
  sampledAt: string;
  channels: [LiveChannelData, LiveChannelData];
  system: {
    totalActPowerW: number;
    totalAprtPowerVA: number;
    totalReactivePowerVAr: number;
    netPowerW: number;
  };
}

type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

const WS_URL =
  process.env["NEXT_PUBLIC_WS_URL"] ?? "ws://localhost:3000";

const RECONNECT_DELAY_MS = 3000;
const PING_INTERVAL_MS = 15000;

export function useLiveData() {
  const [data, setData] = useState<LiveReadingsEvent | null>(null);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");

  const wsRef = useRef<WebSocket | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const clearTimers = useCallback(() => {
    if (pingTimerRef.current) clearInterval(pingTimerRef.current);
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const ws = new WebSocket(`${WS_URL}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return ws.close();
      setConnectionState("connected");

      // Keepalive ping
      pingTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send("ping");
      }, PING_INTERVAL_MS);
    };

    ws.onmessage = (evt) => {
      if (!mountedRef.current || evt.data === "pong") return;
      try {
        const event = JSON.parse(evt.data as string) as LiveReadingsEvent;
        setData(event);
      } catch {
        // Ignore malformed frames
      }
    };

    ws.onclose = () => {
      clearTimers();
      if (!mountedRef.current) return;
      setConnectionState("disconnected");
      reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
    };

    ws.onerror = () => {
      setConnectionState("error");
      ws.close();
    };
  }, [clearTimers]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      clearTimers();
      wsRef.current?.close();
    };
  }, [connect, clearTimers]);

  return { data, connectionState };
}
