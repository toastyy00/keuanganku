import React, { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PocketDetail } from '../components/portfolio/PocketDetail';
import { PocketList } from '../components/portfolio/PocketList';
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

const PortfolioPage: React.FC = () => {
  const navigate = useNavigate();
  const { pocketId } = useParams<{ pocketId?: string; slug?: string }>();
  const loadPortfolio = usePortfolioStore((s) => s.loadPortfolio);
  const pockets = usePortfolioStore((s) => s.pockets);
  const activePocketId = pocketId ?? null;
  const activePocket = activePocketId ? pockets.find((item) => item.id === activePocketId) : undefined;
  const hasPocket = !!activePocket;

  useEffect(() => {
    document.title = 'Portfolio - KeuanganKu';
    void loadPortfolio();
    return () => {
      document.title = 'Keuanganku';
    };
  }, [loadPortfolio]);

  useEffect(() => {
    if (!activePocketId) return;
    if (pockets.length === 0) return;
    if (!hasPocket) navigate('/portfolio', { replace: true });
  }, [activePocketId, hasPocket, navigate, pockets.length]);

  return (
    <div className="portfolio-touch mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 pb-10 pt-6 md:px-6">
      {activePocketId ? (
        <PocketDetail
          pocketId={activePocketId}
          onBack={() => navigate('/portfolio')}
        />
      ) : (
        <PocketList
          onOpenPocket={(pocket) => {
            const slug = slugifyPocketName(pocket.name);
            navigate(slug ? `/portfolio/${pocket.id}/${slug}` : `/portfolio/${pocket.id}`);
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
