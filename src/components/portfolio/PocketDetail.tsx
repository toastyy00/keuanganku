import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { usePortfolioStore } from '../../store/usePortfolioStore';
import { AddAssetSheet } from './AddAssetSheet';
import { AssetActionSheet } from './AssetActionSheet';
import { ActivityFeed } from './ActivityFeed';
import { PocketSettingsSheet } from './PocketSettingsSheet';
import { PortfolioChart } from './PortfolioChart';
import type { PortfolioAsset, PortfolioPocket } from '../../types';

interface PocketDetailProps {
  pocketId: string;
  onBack: () => void;
}

const FRAMES: Array<'24H' | '1W' | '1M' | '1Y' | 'ALL'> = ['24H', '1W', '1M', '1Y', 'ALL'];

const PocketDetail: React.FC<PocketDetailProps> = ({ pocketId, onBack }) => {
  const pockets = usePortfolioStore((s) => s.pockets);
  const assets = usePortfolioStore((s) => s.assets);
  const prices = usePortfolioStore((s) => s.prices);
  const logs = usePortfolioStore((s) => s.activityLogs);
  const chartByPocket = usePortfolioStore((s) => s.chartSeriesByPocket);
  const fetchPrices = usePortfolioStore((s) => s.fetchPrices);
  const refreshPrices = usePortfolioStore((s) => s.refreshPrices);
  const refreshChartSeries = usePortfolioStore((s) => s.refreshChartSeries);
  const addAsset = usePortfolioStore((s) => s.addAsset);
  const updateAssetAmount = usePortfolioStore((s) => s.updateAssetAmount);
  const removeAsset = usePortfolioStore((s) => s.removeAsset);
  const updatePocket = usePortfolioStore((s) => s.updatePocket);
  const deletePocket = usePortfolioStore((s) => s.deletePocket);
  const [timeframe, setTimeframe] = useState<'24H' | '1W' | '1M' | '1Y' | 'ALL'>('24H');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [assetAction, setAssetAction] = useState<PortfolioAsset | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [scrubValue, setScrubValue] = useState<number | null>(null);
  const [scrubPointValue, setScrubPointValue] = useState<number | null>(null);
  const [isBackPressed, setIsBackPressed] = useState(false);
  const [isRefreshPressed, setIsRefreshPressed] = useState(false);
  const refreshReleaseTimerRef = useRef<number | null>(null);
  const backReleaseTimerRef = useRef<number | null>(null);

  const pocket = pockets.find((item) => item.id === pocketId) as PortfolioPocket | undefined;
  const pocketAssets = useMemo(() => assets.filter((item) => item.pocket_id === pocketId), [assets, pocketId]);
  const pocketLogs = useMemo(
    () => logs.filter((item) => item.pocket_id === pocketId).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [logs, pocketId]
  );

  useEffect(() => {
    void fetchPrices(pocketId);
    void refreshChartSeries(pocketId, timeframe);
  }, [pocketId, timeframe, fetchPrices, refreshChartSeries, pocketAssets.length]);

  useEffect(() => {
    return () => {
      if (refreshReleaseTimerRef.current !== null) {
        window.clearTimeout(refreshReleaseTimerRef.current);
      }
      if (backReleaseTimerRef.current !== null) {
        window.clearTimeout(backReleaseTimerRef.current);
      }
    };
  }, []);

  const totalUsd = pocketAssets.reduce((sum, item) => {
    const usd = prices[item.coingecko_id ?? '']?.usd ?? 0;
    return sum + usd * item.amount;
  }, 0);

  const chartData = chartByPocket[pocketId] ?? [];
  const displayValue = scrubValue ?? totalUsd;
  const firstPointValue = chartData[0]?.value ?? 0;
  const endPointValue = scrubPointValue ?? chartData[chartData.length - 1]?.value ?? 0;
  const changeValue = endPointValue - firstPointValue;
  const changePct = firstPointValue === 0 ? 0 : (changeValue / firstPointValue) * 100;
  const isChangePositive = changeValue >= 0;
  const changeColorClass = isChangePositive ? 'text-[#8FE06A]' : 'text-[#FF6B6B]';
  const changeSign = isChangePositive ? '+' : '-';

  if (!pocket) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between pt-0.5">
        <button
          type="button"
          onPointerDown={() => {
            if (backReleaseTimerRef.current !== null) window.clearTimeout(backReleaseTimerRef.current);
            setIsBackPressed(true);
          }}
          onPointerUp={() => {
            if (backReleaseTimerRef.current !== null) window.clearTimeout(backReleaseTimerRef.current);
            backReleaseTimerRef.current = window.setTimeout(() => setIsBackPressed(false), 45);
          }}
          onPointerLeave={() => setIsBackPressed(false)}
          onPointerCancel={() => setIsBackPressed(false)}
          onBlur={() => setIsBackPressed(false)}
          onClick={() => window.setTimeout(() => onBack(), 28)}
          className={`inline-flex h-9 w-9 items-center justify-center border-[3px] border-[#F5F0E8] bg-[#1E1E1E] text-[#F5F0E8] transition-[transform,box-shadow] duration-100 md:hover:-translate-y-0.5 md:hover:shadow-[6px_8px_0_0_#969696] ${
            isBackPressed ? 'translate-x-[5px] translate-y-[5px] shadow-none' : 'shadow-[4px_4px_0_0_#969696]'
          }`}
        >
          <ArrowLeft size={16} strokeWidth={3.2} />
        </button>
        <div className="flex max-w-[70%] flex-col items-end gap-0 pt-0.5 text-right leading-none">
          <p className="text-[12px] font-black uppercase tracking-[0.18em] text-[#B8F55A]">Portfolio</p>
          <p className="mt-[-6px] w-full truncate text-[24px] font-black uppercase tracking-[-0.01em] text-[#F5F0E8]">{pocket.name}</p>
        </div>
      </div>

      <section
        className="neo-card !border-0 overflow-hidden"
        style={{
          background: `linear-gradient(124deg, #222326 10%, #262931 42%, ${pocket.color_theme}58 78%, ${pocket.color_theme}75 100%)`,
        }}
      >
        <div className="px-4 pt-4">
          <div className="mb-3 flex items-start justify-between">
            <div>
              <p className="text-xs font-black uppercase text-brutal-black/50">Total Assets</p>
              <p className="text-2xl font-black">{formatCurrency(displayValue * 16000, 'IDR')}</p>
              <p className="text-sm font-bold text-brutal-black/60">${displayValue.toFixed(2)}</p>
              <p className={`mt-1 text-sm font-black ${changeColorClass}`}>
                {`${changeSign}$${Math.abs(changeValue).toFixed(2)} (${changeSign}${Math.abs(changePct).toFixed(2)}%) ${timeframe}`}
              </p>
            </div>
            <button
              type="button"
              className={`inline-flex h-9 w-9 items-center justify-center border-2 transition-[transform,box-shadow] duration-150 ease-out ${
                isRefreshPressed ? 'translate-x-1 translate-y-1' : ''
              }`}
              style={{
                borderColor: `${pocket.color_theme}`,
                color: `${pocket.color_theme}`,
                backgroundColor: 'rgba(20,20,24,0.45)',
                boxShadow: isRefreshPressed
                  ? `inset 0 0 0 2px ${pocket.color_theme}`
                  : `2px 2px 0 0 rgba(0,0,0,0.45), inset 0 0 0 1px ${pocket.color_theme}33`,
              }}
              onPointerDown={() => {
                if (refreshReleaseTimerRef.current !== null) {
                  window.clearTimeout(refreshReleaseTimerRef.current);
                }
                setIsRefreshPressed(true);
              }}
              onPointerUp={() => {
                if (refreshReleaseTimerRef.current !== null) {
                  window.clearTimeout(refreshReleaseTimerRef.current);
                }
                refreshReleaseTimerRef.current = window.setTimeout(() => {
                  setIsRefreshPressed(false);
                }, 120);
              }}
              onPointerLeave={() => setIsRefreshPressed(false)}
              onPointerCancel={() => setIsRefreshPressed(false)}
              onBlur={() => setIsRefreshPressed(false)}
              onClick={() => void refreshPrices(pocketId)}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        <div className="w-full">
          <PortfolioChart
            dataPoints={chartData}
            colorTheme={pocket.color_theme}
            timeframe={timeframe}
            onScrub={(point) => {
              setScrubValue(point.value);
              setScrubPointValue(point.value);
            }}
            onScrubEnd={() => {
              setScrubValue(null);
              setScrubPointValue(null);
            }}
          />
        </div>

        <div className="px-4 pb-4">
          <div className="mt-3 grid grid-cols-5 gap-1">
            {FRAMES.map((frame) => (
              <button
                key={frame}
                type="button"
                onClick={() => setTimeframe(frame)}
                className="neo-btn-secondary px-2 py-1 text-[10px]"
                style={timeframe === frame ? { backgroundColor: pocket.color_theme, color: '#1A1A1A' } : undefined}
              >
                {frame}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-black uppercase text-brutal-black/60">Active Balance</p>
          <button type="button" className="neo-btn-primary px-3 py-1 text-xs" onClick={() => setIsAddOpen(true)}>
            ADD ASSET
          </button>
        </div>
        {pocketAssets.map((asset) => {
          const price = prices[asset.coingecko_id ?? '']?.usd ?? 0;
          return (
            <button
              key={asset.id}
              type="button"
              className="neo-card flex w-full items-center justify-between px-3 py-2 text-left"
              onClick={() => setAssetAction(asset)}
            >
              <div>
                <p className="text-sm font-black">{asset.ticker}</p>
                <p className="text-xs font-medium text-brutal-black/60">{asset.amount} · ${price.toFixed(4)}</p>
              </div>
              <p className="text-sm font-black">{formatCurrency(price * asset.amount * 16000, 'IDR')}</p>
            </button>
          );
        })}
      </section>

      <section className="pt-3">
        <p className="mb-2 text-xs font-black uppercase text-brutal-black/60">Activity Feed</p>
        <ActivityFeed logs={pocketLogs} />
      </section>

      <AddAssetSheet
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        onAdd={async (ticker, amount, note) => {
          await addAsset({ pocket_id: pocketId, ticker, amount, coingecko_id: undefined }, note);
          await refreshPrices(pocketId);
          await refreshChartSeries(pocketId, timeframe);
        }}
      />

      <AssetActionSheet
        isOpen={!!assetAction}
        onClose={() => setAssetAction(null)}
        asset={assetAction}
        currentPriceUsd={assetAction ? prices[assetAction.coingecko_id ?? '']?.usd : undefined}
        onApply={async (assetId, newAmount, action, note) => {
          await updateAssetAmount(assetId, newAmount, action, note);
          await refreshPrices(pocketId);
          await refreshChartSeries(pocketId, timeframe);
        }}
        onRemove={async (assetId) => {
          await removeAsset(assetId);
          await refreshPrices(pocketId);
          await refreshChartSeries(pocketId, timeframe);
        }}
      />

      <PocketSettingsSheet
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        pocket={pocket}
        onSave={async (input) => { await updatePocket(pocket.id, input); }}
        onDelete={async () => {
          await deletePocket(pocket.id);
          onBack();
        }}
      />
    </div>
  );
};

export { PocketDetail };
