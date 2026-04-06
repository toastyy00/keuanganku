import React, { useEffect, useState } from 'react';
import { X, Smartphone } from 'lucide-react';
import { useExpenseStore } from '../store/useExpenseStore';

// ============================================================
//  PWA INSTALL BANNER
//  Shows after user logs 3rd expense, triggers native install.
// ============================================================

const DISMISSED_KEY = 'pwa_prompt_dismissed';

// Define the BeforeInstallPromptEvent type which isn't in standard TS libs
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const PWAInstallBanner: React.FC = () => {
  const expenses = useExpenseStore((s) => s.expenses);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => Boolean(localStorage.getItem(DISMISSED_KEY)));

  // Capture the browser's install prompt
  useEffect(() => {
    if (dismissed) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [dismissed]);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      localStorage.setItem(DISMISSED_KEY, '1');
      setDismissed(true);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, '1');
    setDismissed(true);
  };

  const show = expenses.length >= 3 && Boolean(deferredPrompt) && !dismissed;
  if (!show) return null;

  return (
    <div
      className="fixed z-50 left-4 right-4 md:left-auto md:right-8 md:max-w-sm"
      style={{ bottom: 'calc(72px + 8px)' }}
    >
      <div className="neo-card p-4 bg-brutal-yellow animate-in slide-in-from-bottom-4">
        <div className="flex items-start gap-3">
          <Smartphone size={20} strokeWidth={2.5} className="shrink-0 mt-0.5 text-brutal-black" />
          <div className="flex-1">
            <p className="text-sm font-bold leading-snug">
              📲 Tambah Keuanganku ke layar utama untuk akses lebih cepat
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="shrink-0 p-1 hover:bg-brutal-black/10 transition-colors"
            aria-label="Tutup"
          >
            <X size={16} strokeWidth={2.5} />
          </button>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={handleInstall}
            className="flex-1 neo-btn neo-btn-primary text-xs py-2"
          >
            Tambah Sekarang
          </button>
          <button
            onClick={handleDismiss}
            className="flex-1 neo-btn neo-btn-secondary text-xs py-2"
          >
            Nanti Saja
          </button>
        </div>
      </div>
    </div>
  );
};

export { PWAInstallBanner };
