import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import type { AIStatus, Notification, Settings, Subject } from "../lib/types";

interface AppContextValue {
  settings: Settings | null;
  setSettings: (settings: Settings) => void;
  subjects: Subject[];
  notifications: Notification[];
  aiStatus: AIStatus | null;
  loading: boolean;
  error: string;
  refreshSubjects: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  refreshAIStatus: () => Promise<void>;
  refreshSettings: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

const accents = new Set(["violet", "blue", "emerald", "rose", "amber"]);

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const mounted = useRef(true);

  const refreshSubjects = useCallback(async () => {
    const data = await api.subjects();
    if (mounted.current) setSubjects(data);
  }, []);

  const refreshNotifications = useCallback(async () => {
    const data = await api.notifications();
    if (mounted.current) setNotifications(data);
  }, []);

  const refreshAIStatus = useCallback(async () => {
    const data = await api.aiStatus();
    if (mounted.current) setAiStatus(data);
  }, []);

  const refreshSettings = useCallback(async () => {
    const data = await api.settings();
    if (mounted.current) setSettings(data);
  }, []);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      try {
        const [settingsData, subjectData, notificationData, statusData] = await Promise.all([
          api.settings(),
          api.subjects(),
          api.notifications(),
          api.aiStatus(),
        ]);
        if (!mounted.current) return;
        setSettings(settingsData);
        setSubjects(subjectData);
        setNotifications(notificationData);
        setAiStatus(statusData);
      } catch (err) {
        if (mounted.current) setError(err instanceof Error ? err.message : "Could not reach the local backend.");
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    const interval = window.setInterval(() => {
      refreshNotifications().catch(() => undefined);
    }, 60000);
    return () => {
      mounted.current = false;
      window.clearInterval(interval);
    };
  }, [refreshNotifications]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", settings?.theme !== "light");
    root.dataset.accent = accents.has(settings?.accent || "violet") ? settings?.accent || "violet" : "violet";
  }, [settings?.theme, settings?.accent]);

  const value = useMemo(
    () => ({
      settings,
      setSettings,
      subjects,
      notifications,
      aiStatus,
      loading,
      error,
      refreshSubjects,
      refreshNotifications,
      refreshAIStatus,
      refreshSettings,
    }),
    [settings, subjects, notifications, aiStatus, loading, error, refreshSubjects, refreshNotifications, refreshAIStatus, refreshSettings],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside AppProvider");
  return context;
}
