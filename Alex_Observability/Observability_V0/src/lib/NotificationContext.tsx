import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type NotificationType = 'paused' | 'error';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  robotSerial: string | null;
  robotIp?: string;
  createdAt: number;
}

interface NotificationContextValue {
  notifications: Notification[];
  addNotification: (n: Omit<Notification, 'id' | 'createdAt'>) => void;
  dismissNotification: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

const AUTO_DISMISS_MS = 12_000;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const timeoutRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissNotification = useCallback((id: string) => {
    const t = timeoutRefs.current.get(id);
    if (t) clearTimeout(t);
    timeoutRefs.current.delete(id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const addNotification = useCallback(
    (n: Omit<Notification, 'id' | 'createdAt'>) => {
      const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const createdAt = Date.now();
      const notification: Notification = { ...n, id, createdAt };

      setNotifications((prev) => [...prev.slice(-19), notification]);

      const timeoutId = setTimeout(() => {
        timeoutRefs.current.delete(id);
        setNotifications((prev) => prev.filter((item) => item.id !== id));
      }, AUTO_DISMISS_MS);
      timeoutRefs.current.set(id, timeoutId);
    },
    []
  );

  return (
    <NotificationContext.Provider
      value={{ notifications, addNotification, dismissNotification }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}

export function NotificationToasts() {
  const { notifications, dismissNotification } = useNotifications();

  if (notifications.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-6 right-6 z-50 flex max-h-[80vh] w-full max-w-[420px] flex-col gap-2 sm:pointer-events-auto"
      role="region"
      aria-label="Notifications"
    >
      {notifications.map((n) => (
        <div
          key={n.id}
          role="alert"
          className={`flex min-w-0 flex-col gap-1 rounded-xl border px-4 py-3 shadow-lg ${
            n.type === 'error'
              ? 'border-error/40 bg-error-muted/95 text-foreground'
              : 'border-amber-500/40 bg-amber-50 text-foreground'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold text-sm">{n.title}</span>
            <button
              type="button"
              onClick={() => dismissNotification(n.id)}
              aria-label="Dismiss notification"
              className="shrink-0 rounded p-1 text-muted-foreground hover:bg-black/10 hover:text-foreground"
            >
              ×
            </button>
          </div>
          <p className="text-sm text-muted-foreground">{n.message}</p>
          {(n.robotSerial || n.robotIp) && (
            <p className="font-mono text-xs text-muted-foreground">
              Robot{n.robotSerial ? ` ${n.robotSerial}` : ''}
              {n.robotIp ? ` · ${n.robotIp}` : ''}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
