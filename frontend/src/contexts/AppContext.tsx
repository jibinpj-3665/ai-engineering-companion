import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "../lib/api";
import type { AIStatus, AuthStatus, AuthUser, Notification, Settings, Subject } from "../lib/types";

interface AppContextValue {
  settings: Settings | null;
  setSettings: (settings: Settings) => void;
  subjects: Subject[];
  notifications: Notification[];
  aiStatus: AIStatus | null;
  auth: AuthStatus | null;
  user: AuthUser | null;
  authRequired: boolean;
  registrationAllowed: boolean;
  smtpConfigured: boolean;
  envKeysOnly: boolean;
  providerKeys: Record<string, boolean>;
  loading: boolean;
  error: string;
  refreshSubjects: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  refreshAIStatus: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  refreshAuth: () => Promise<AuthStatus>;
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (name: string, email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshWorkspace: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

const accents = new Set(["violet", "blue", "emerald", "rose", "amber"]);

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
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

  const refreshAuth = useCallback(async () => {
    const status = await api.authStatus();
    if (mounted.current) {
      setAuth(status);
      setUser(status.user);
    }
    return status;
  }, []);

  const refreshWorkspace = useCallback(async () => {
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
    setError("");
  }, []);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      try {
        const status = await api.authStatus();
        if (!mounted.current) return;
        setAuth(status);
        setUser(status.user);
        if (status.user) {
          await refreshWorkspace();
        } else if (!status.auth_required) {
          setError("The local workspace account could not be initialised. Check the backend log.");
        }
      } catch (err) {
        if (mounted.current) setError(err instanceof Error ? err.message : "Could not reach the backend.");
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshWorkspace]);

  useEffect(() => {
    if (!user) return;
    const interval = window.setInterval(() => {
      refreshNotifications().catch(() => undefined);
    }, 60000);
    return () => window.clearInterval(interval);
  }, [user, refreshNotifications]);

  useEffect(() => {
    const onUnauthorized = (event: Event) => {
      const detail = (event as CustomEvent<{ detail?: string; authRequired?: boolean }>).detail;
      setUser(null);
      setAuth((current) => current ? {
        ...current,
        auth_required: detail?.authRequired ?? current.auth_required,
        user: null,
      } : current);
      setError(detail?.detail || "Your session has expired. Sign in again.");
    };
    window.addEventListener("aec:unauthorized", onUnauthorized);
    return () => window.removeEventListener("aec:unauthorized", onUnauthorized);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", settings?.theme !== "light");
    root.dataset.accent = accents.has(settings?.accent || "violet") ? settings?.accent || "violet" : "violet";
  }, [settings?.theme, settings?.accent]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await api.login(email, password);
    setUser(response.user);
    setAuth((current) => current ? { ...current, user: response.user } : current);
    setError("");
    await refreshWorkspace();
    return response.user;
  }, [refreshWorkspace]);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const response = await api.register(name, email, password);
    setUser(response.user);
    setAuth((current) => current ? { ...current, user: response.user } : current);
    setError("");
    await refreshWorkspace();
    return response.user;
  }, [refreshWorkspace]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    }
    setUser(null);
    setSettings(null);
    setSubjects([]);
    setNotifications([]);
    setAiStatus(null);
    setError("");
    const status = await refreshAuth();
    if (!status.auth_required) {
      window.location.reload();
    }
  }, [refreshAuth]);

  const value = useMemo(
    () => ({
      settings,
      setSettings,
      subjects,
      notifications,
      aiStatus,
      auth,
      user,
      authRequired: auth?.auth_required ?? false,
      registrationAllowed: auth?.registration_allowed ?? false,
      smtpConfigured: auth?.smtp_configured ?? false,
      envKeysOnly: auth?.env_keys_only ?? false,
      providerKeys: auth?.provider_keys ?? {},
      loading,
      error,
      refreshSubjects,
      refreshNotifications,
      refreshAIStatus,
      refreshSettings,
      refreshAuth,
      login,
      register,
      logout,
      refreshWorkspace,
    }),
    [settings, subjects, notifications, aiStatus, auth, user, loading, error, refreshSubjects, refreshNotifications, refreshAIStatus, refreshSettings, refreshAuth, login, register, logout, refreshWorkspace],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside AppProvider");
  return context;
}
