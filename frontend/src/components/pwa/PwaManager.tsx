import { useEffect, useState } from "react";
import { Download, RefreshCw, WifiOff, X } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaManager() {
  const { toast } = useToast();
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installDismissed, setInstallDismissed] = useState(() => localStorage.getItem("aec-install-dismissed") === "1");
  const [online, setOnline] = useState(navigator.onLine);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        window.setInterval(() => { registration.update().catch(() => undefined); }, 60 * 60 * 1000);
      }
    },
  });

  useEffect(() => {
    if (offlineReady) {
      toast("Offline shell ready", "The app interface is cached. Uploaded material and AI features still need a connection.", "success");
      setOfflineReady(false);
    }
  }, [offlineReady, setOfflineReady, toast]);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallEvent(null);
      toast("App installed", "Launch the companion from your home screen or app list.", "success");
    };
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [toast]);

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome !== "accepted") {
      setInstallDismissed(true);
      localStorage.setItem("aec-install-dismissed", "1");
    }
    setInstallEvent(null);
  };

  const dismissInstall = () => {
    setInstallDismissed(true);
    localStorage.setItem("aec-install-dismissed", "1");
  };

  return (
    <>
      {!online ? (
        <div className="fixed left-1/2 top-2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full border border-warning/30 bg-warning/[0.12] px-3 py-1.5 text-[11px] font-medium text-warning shadow-lg backdrop-blur-xl">
          <WifiOff size={12} /> Offline — cached pages only
        </div>
      ) : null}
      <div className="pointer-events-none fixed bottom-20 right-3 z-[55] flex w-[min(330px,calc(100vw-1.5rem))] flex-col gap-2 lg:bottom-5 lg:right-5">
        {needRefresh ? (
          <div className="pointer-events-auto rounded-2xl border border-primary/30 bg-card/95 p-4 shadow-xl backdrop-blur-xl">
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><RefreshCw size={15} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold">A new version is available</p>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Reload to get the latest fixes. Unsaved text in the tutor box may be lost.</p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => updateServiceWorker(true)}>Reload</Button>
                  <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>Later</Button>
                </div>
              </div>
              <button onClick={() => setNeedRefresh(false)} aria-label="Dismiss update" className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
            </div>
          </div>
        ) : null}
        {installEvent && !installDismissed ? (
          <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-border/80 bg-card/95 p-3 shadow-xl backdrop-blur-xl">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Download size={15} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold">Install on this device</p>
              <p className="text-[10px] text-muted-foreground">Full-screen, faster launch, home screen icon.</p>
            </div>
            <Button size="sm" onClick={install}>Install</Button>
            <button onClick={dismissInstall} aria-label="Dismiss install prompt" className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
          </div>
        ) : null}
      </div>
    </>
  );
}
