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
      <div className="flex-1">
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
      </div>

      <footer className="mt-auto pt-10 pb-4 text-center text-[10px] font-black uppercase tracking-[0.18em] text-[#44474D]">
        Powered by{' '}
        <a
          href="https://www.coingecko.com/?utm_source=keuanganku&utm_medium=referral"
          target="_blank"
          rel="noreferrer"
          className="underline decoration-[#44474D]/50 underline-offset-2 hover:text-[#F5F0E8] hover:decoration-[#F5F0E8] transition-colors"
          onClick={(event) => event.stopPropagation()}
        >
          CoinGecko API
        </a>
      </footer>

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
