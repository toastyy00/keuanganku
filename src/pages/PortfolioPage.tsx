import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PocketDetail } from '../components/portfolio/PocketDetail';
import { PocketList } from '../components/portfolio/PocketList';
import { GUEST_DATA_SCOPE } from '../lib/dataScope';
import { useAuthStore } from '../store/useAuthStore';
import { usePortfolioStore } from '../store/usePortfolioStore';

function slugifyPocketName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

let hasPlayedPortfolioSparklineReveal = false;
let portfolioVisitResetTimer: number | null = null;

const PortfolioPage: React.FC = () => {
  const navigate = useNavigate();
  const { pocketId } = useParams<{ pocketId?: string; slug?: string }>();
  const user = useAuthStore((s) => s.user);
  const portfolioHydrated = usePortfolioStore((s) => s._hasHydrated);
  const cacheScope = usePortfolioStore((s) => s.cacheScope);
  const ensureScope = usePortfolioStore((s) => s.ensureScope);
  const loadPortfolio = usePortfolioStore((s) => s.loadPortfolio);
  const pockets = usePortfolioStore((s) => s.pockets);
  const activeScope = user?.id ?? GUEST_DATA_SCOPE;
  const isPortfolioScopeReady = portfolioHydrated && cacheScope === activeScope;
  const activePocketId = pocketId ?? null;
  const activePocket = activePocketId ? pockets.find((item) => item.id === activePocketId) : undefined;
  const hasPocket = !!activePocket;
  const [hasPlayedMiniSparklineReveal, setHasPlayedMiniSparklineReveal] = useState(() => hasPlayedPortfolioSparklineReveal);

  const markMiniSparklineRevealComplete = useCallback(() => {
    hasPlayedPortfolioSparklineReveal = true;
    setHasPlayedMiniSparklineReveal(true);
  }, []);

  useEffect(() => {
    document.title = 'Pockets - KeuanganKu';
    return () => {
      document.title = 'Keuanganku';
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (portfolioVisitResetTimer !== null) {
      window.clearTimeout(portfolioVisitResetTimer);
      portfolioVisitResetTimer = null;
    }

    return () => {
      portfolioVisitResetTimer = window.setTimeout(() => {
        const isStillInsidePortfolio = /(?:^|\/)pockets(?:\/|$)/.test(window.location.pathname);
        if (!isStillInsidePortfolio) {
          hasPlayedPortfolioSparklineReveal = false;
        }
        portfolioVisitResetTimer = null;
      }, 0);
    };
  }, []);

  useEffect(() => {
    if (!portfolioHydrated) return;
    ensureScope(activeScope);
  }, [activeScope, ensureScope, portfolioHydrated]);

  useEffect(() => {
    if (!portfolioHydrated || cacheScope !== activeScope) return;
    void loadPortfolio();
  }, [activeScope, cacheScope, loadPortfolio, portfolioHydrated]);

  useEffect(() => {
    if (!activePocketId) return;
    if (pockets.length === 0) return;
    if (!hasPocket) navigate('/pockets', { replace: true });
  }, [activePocketId, hasPocket, navigate, pockets.length]);

  if (!isPortfolioScopeReady) {
    return (
      <div className="portfolio-touch mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 pb-10 pt-6 md:px-6" />
    );
  }

  return (
    <div className="portfolio-touch mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 pb-10 pt-6 md:px-6">
      {activePocketId ? (
        <PocketDetail
          pocketId={activePocketId}
          onBack={() => navigate('/pockets')}
        />
      ) : (
        <PocketList
          shouldAnimateTotalSparkline={!hasPlayedMiniSparklineReveal}
          onTotalSparklineRevealComplete={markMiniSparklineRevealComplete}
          onOpenPocket={(pocket) => {
            markMiniSparklineRevealComplete();
            const slug = slugifyPocketName(pocket.name);
            navigate(slug ? `/pockets/${pocket.id}/${slug}` : `/pockets/${pocket.id}`);
          }}
        />
      )}

      {!activePocketId && (
        <button
          type="button"
          className="sr-only"
          onClick={() => navigate('/')}
        >
          Back to dashboard
        </button>
      )}
    </div>
  );
};

export default PortfolioPage;
