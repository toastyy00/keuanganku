import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PocketDetail } from '../components/portfolio/PocketDetail';
import { PocketList } from '../components/portfolio/PocketList';
import { usePortfolioStore } from '../store/usePortfolioStore';

const ACTIVE_POCKET_KEY = 'portfolio_active_pocket';

const PortfolioPage: React.FC = () => {
  const navigate = useNavigate();
  const loadPortfolio = usePortfolioStore((s) => s.loadPortfolio);
  const [activePocketId, setActivePocketId] = useState<string | null>(() => {
    return sessionStorage.getItem(ACTIVE_POCKET_KEY);
  });

  useEffect(() => {
    document.title = 'Portfolio - KeuanganKu';
    void loadPortfolio();
    return () => {
      document.title = 'Keuanganku';
    };
  }, [loadPortfolio]);

  return (
    <div className="portfolio-touch mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 pb-10 pt-6 md:px-6">
      {activePocketId ? (
        <PocketDetail
          pocketId={activePocketId}
          onBack={() => {
            setActivePocketId(null);
            sessionStorage.removeItem(ACTIVE_POCKET_KEY);
          }}
        />
      ) : (
        <PocketList
          onOpenPocket={(pocketId) => {
            setActivePocketId(pocketId);
            sessionStorage.setItem(ACTIVE_POCKET_KEY, pocketId);
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
