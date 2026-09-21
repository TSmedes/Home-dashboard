import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { DashboardConfig, ProfileOverride, StreamEvent, WidgetEnvelope } from "@home-dash/shared";

export type ConnectionState = "connecting" | "live" | "offline";

export interface DashboardSnapshot {
  config: DashboardConfig | null;
  activeProfile: string | null;
  /** A manual profile switch in force, or null when the schedule decides. */
  override: ProfileOverride | null;
  availableSources: string[];
  envelopes: Record<string, WidgetEnvelope<unknown>>;
  connection: ConnectionState;
  /** Set only when the dashboard could not load at all. */
  fatal: string | null;
}

const DashboardContext = createContext<DashboardSnapshot | null>(null);

/** If nothing arrives in this long - not even a heartbeat - the stream is dead. */
const STREAM_TIMEOUT_MS = 60_000;
const WATCHDOG_INTERVAL_MS = 15_000;

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<DashboardConfig | null>(null);
  const [activeProfile, setActiveProfile] = useState<string | null>(null);
  const [override, setOverride] = useState<ProfileOverride | null>(null);
  const [availableSources, setAvailableSources] = useState<string[]>([]);
  const [envelopes, setEnvelopes] = useState<Record<string, WidgetEnvelope<unknown>>>({});
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [fatal, setFatal] = useState<string | null>(null);

  const sourceRef = useRef<EventSource | null>(null);
  const lastMessageRef = useRef<number>(Date.now());

  const loadConfig = useCallback(async () => {
    try {
      const response = await fetch("/api/config");
      if (!response.ok) throw new Error(`server returned ${response.status}`);
      const body = (await response.json()) as {
        config: DashboardConfig;
        activeProfile: string;
        override: ProfileOverride | null;
        availableSources: string[];
      };
      setConfig(body.config);
      setActiveProfile(body.activeProfile);
      setOverride(body.override ?? null);
      setAvailableSources(body.availableSources);
      setFatal(null);
    } catch (cause) {
      setFatal(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const connect = useCallback(() => {
    sourceRef.current?.close();
    setConnection("connecting");

    const stream = new EventSource("/api/stream");
    sourceRef.current = stream;

    const handle = (event: MessageEvent<string>) => {
      lastMessageRef.current = Date.now();
      setConnection("live");
      let payload: StreamEvent;
      try {
        payload = JSON.parse(event.data) as StreamEvent;
      } catch {
        return;
      }
      switch (payload.type) {
        case "widget-data":
          setEnvelopes((prev) => ({ ...prev, [payload.key]: payload.envelope }));
          break;
        case "profile-changed":
          setActiveProfile(payload.profile);
          setOverride(payload.override);
          break;
        case "config-changed":
          void loadConfig();
          break;
        case "hello":
          setActiveProfile(payload.profile);
          setOverride(payload.override);
          break;
        case "ping":
          break;
      }
    };

    for (const type of ["widget-data", "profile-changed", "config-changed", "hello", "ping"]) {
      stream.addEventListener(type, handle as EventListener);
    }
    stream.onerror = () => setConnection("offline");
    stream.onopen = () => {
      lastMessageRef.current = Date.now();
      setConnection("live");
    };
  }, [loadConfig]);

  useEffect(() => {
    void loadConfig();
    connect();
    return () => sourceRef.current?.close();
  }, [connect, loadConfig]);

  /**
   * An iPad that sleeps leaves the socket half-open: no error fires, nothing
   * arrives, and the wall quietly shows yesterday's numbers. Reconnect whenever
   * the tablet wakes, and independently whenever heartbeats stop.
   */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void loadConfig();
      if (sourceRef.current?.readyState !== EventSource.OPEN) connect();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);

    const watchdog = window.setInterval(() => {
      if (Date.now() - lastMessageRef.current > STREAM_TIMEOUT_MS) connect();
    }, WATCHDOG_INTERVAL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      window.clearInterval(watchdog);
    };
  }, [connect, loadConfig]);

  const snapshot = useMemo<DashboardSnapshot>(
    () => ({ config, activeProfile, override, availableSources, envelopes, connection, fatal }),
    [config, activeProfile, override, availableSources, envelopes, connection, fatal],
  );

  return <DashboardContext.Provider value={snapshot}>{children}</DashboardContext.Provider>;
}

export function useDashboard(): DashboardSnapshot {
  const value = useContext(DashboardContext);
  if (!value) throw new Error("useDashboard must be used inside a DashboardProvider");
  return value;
}
