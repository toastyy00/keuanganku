import React, { useState } from 'react';
import { ArrowLeft, BriefcaseBusiness, Ellipsis, Landmark, Link2, Shield, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePortfolioStore } from '../../store/usePortfolioStore';
import type { PortfolioPocket } from '../../types';
import { PocketSettingsSheet } from './PocketSettingsSheet';

interface PocketListProps {
  onOpenPocket: (pocket: PortfolioPocket) => void;
}

function withAlpha(hex: string, alphaHex: string): string {
  const cleaned = hex.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(cleaned)) return '#1B1B1E';
  return `${cleaned}${alphaHex}`;
}

function buildPocketAccentGradient(colorTheme: string): string {
  return `linear-gradient(135deg, #1B1B1E 0%, #22252C 48%, ${withAlpha(colorTheme, '52')} 100%)`;
}

function renderPocketIcon(icon?: string) {
  const normalized = (icon ?? '').toLowerCase();
  if (normalized.includes('wallet')) return <Wallet size={26} strokeWidth={2.4} />;
  if (normalized.includes('bank')) return <Landmark size={26} strokeWidth={2.4} />;
  if (normalized.includes('shield')) return <Shield size={26} strokeWidth={2.4} />;
  if (normalized.includes('link')) return <Link2 size={26} strokeWidth={2.4} />;
  return <BriefcaseBusiness size={26} strokeWidth={2.4} />;
}

const PocketList: React.FC<PocketListProps> = ({ onOpenPocket }) => {
  const navigate = useNavigate();
  const pockets = usePortfolioStore((s) => s.pockets);
  const assets = usePortfolioStore((s) => s.assets);
  const addPocket = usePortfolioStore((s) => s.addPocket);
  const updatePocket = usePortfolioStore((s) => s.updatePocket);
  const deletePocket = usePortfolioStore((s) => s.deletePocket);
  const [editing, setEditing] = useState<PortfolioPocket | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [settingsPressedId, setSettingsPressedId] = useState<string | null>(null);
  const [settingsTapId, setSettingsTapId] = useState<string | null>(null);
  const [cardTapId, setCardTapId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between pt-0.5">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="inline-flex h-9 w-9 items-center justify-center border-[3px] border-[#F5F0E8] bg-[#1E1E1E] text-[#F5F0E8] shadow-[4px_4px_0_0_#969696] transition-[transform,box-shadow] duration-150 md:hover:-translate-y-0.5 md:hover:shadow-[6px_8px_0_0_#969696] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none md:active:translate-x-[4px] md:active:translate-y-[4px] md:active:shadow-none"
        >
          <ArrowLeft size={16} strokeWidth={3.2} />
        </button>
        <div className="flex flex-col items-end gap-0 pt-0.5 text-right leading-none">
          <p className="text-[12px] font-black uppercase tracking-[0.18em] text-[#B8F55A]">Portfolio</p>
          <p className="mt-[-6px] text-[24px] font-black uppercase tracking-[-0.01em] text-[#F5F0E8]">Tracker</p>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <p className="text-[11px] font-black uppercase tracking-[0.24em] text-[#E9E5DD]">My Pockets</p>
        <div className="h-[2px] flex-1 bg-[#2E3138]" />
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setIsSheetOpen(true);
          }}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#5E8F2A] bg-[linear-gradient(145deg,#1A2315_0%,#23311B_48%,#2E4220_100%)] text-[#B8F55A] shadow-[2px_2px_0_0_#37551E] transition-[transform,box-shadow] duration-150 md:hover:-translate-y-0.5 md:hover:shadow-[3px_5px_0_0_#37551E] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none md:active:translate-x-[3px] md:active:translate-y-[3px] md:active:shadow-none"
          aria-label="Create new pocket"
          title="Create new pocket"
        >
          <span className="sr-only">Add pocket</span>
          <span className="text-[24px] font-medium leading-none">+</span>
        </button>
      </div>

      <div className="space-y-2.5">
        {pockets.map((pocket) => {
          const count = assets.filter((item) => item.pocket_id === pocket.id).length;
          const sourceLine = `${pocket.source_type}${pocket.source ? ` - ${pocket.source.toUpperCase()}` : ''} - ${count} ASSETS`;

          return (
            <div
              key={pocket.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenPocket(pocket)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenPocket(pocket);
                }
              }}
              className={`group relative block w-full bg-[#1D1D1D] px-2 py-2 text-left transition-[transform,box-shadow] duration-150 ${
                cardTapId === pocket.id ? 'translate-x-[4px] translate-y-[4px] shadow-none' : 'shadow-[4px_4px_0_0_#969696] md:hover:-translate-y-0.5 md:hover:shadow-[6px_8px_0_0_#969696]'
              }`}
              style={{
                background: `linear-gradient(124deg, #222326 10%, #262931 42%, ${pocket.color_theme}58 78%, ${pocket.color_theme}75 100%)`,
              }}
              onPointerDown={() => setCardTapId(pocket.id)}
              onPointerUp={() => setCardTapId((current) => (current === pocket.id ? null : current))}
              onPointerLeave={() => setCardTapId((current) => (current === pocket.id ? null : current))}
              onPointerCancel={() => setCardTapId((current) => (current === pocket.id ? null : current))}
            >
              <div className="flex min-h-[56px] items-center gap-2.5">
                <div
                  className="flex h-[48px] w-[48px] shrink-0 items-center justify-center border-2"
                  style={{
                    borderColor: `${pocket.color_theme}`,
                    background: buildPocketAccentGradient(pocket.color_theme),
                  }}
                >
                  <div style={{ color: pocket.color_theme }}>
                    <div className="scale-[0.86]">{renderPocketIcon(pocket.icon)}</div>
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[17px] font-black leading-[0.95] tracking-[-0.01em] text-[#F5F0E8]">{pocket.name}</p>
                  <p className="mt-0.5 text-[8px] font-black uppercase tracking-[0.08em] text-[#F5F0E8]/90">{sourceLine}</p>
                </div>

                <button
                  type="button"
                  aria-label={`Edit pocket ${pocket.name}`}
                  title="Pocket settings"
                  className={`ml-1 inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center border-2 bg-[#1B1B1E] transition-[transform,box-shadow] duration-150 ${
                    settingsPressedId === pocket.id ? 'scale-90 rotate-6' : 'scale-100 rotate-0'
                  } ${settingsTapId === pocket.id ? 'translate-x-[4px] translate-y-[4px] shadow-[0_0_0_0_#969696]' : 'shadow-[3px_3px_0_0_#969696]'}`}
                  style={{
                    borderColor: `${pocket.color_theme}`,
                    color: pocket.color_theme,
                    background: buildPocketAccentGradient(pocket.color_theme),
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSettingsTapId(pocket.id);
                    setCardTapId((current) => (current === pocket.id ? null : current));
                  }}
                  onPointerUp={(e) => {
                    e.stopPropagation();
                    setSettingsTapId((current) => (current === pocket.id ? null : current));
                  }}
                  onPointerLeave={() => setSettingsTapId((current) => (current === pocket.id ? null : current))}
                  onPointerCancel={() => setSettingsTapId((current) => (current === pocket.id ? null : current))}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSettingsPressedId(pocket.id);
                    window.setTimeout(() => setSettingsPressedId((current) => (current === pocket.id ? null : current)), 180);
                    setEditing(pocket);
                    setIsSheetOpen(true);
                  }}
                >
                  <Ellipsis size={17} strokeWidth={2.8} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="pt-2 text-center text-[10px] font-black uppercase tracking-[0.24em] text-[#44474D]">Prices refresh inside each pocket.</p>

      <PocketSettingsSheet
        isOpen={isSheetOpen}
        onClose={() => setIsSheetOpen(false)}
        pocket={editing}
        onSave={async (input) => {
          if (editing) await updatePocket(editing.id, input);
          else await addPocket(input);
        }}
        onDelete={editing ? async () => deletePocket(editing.id) : undefined}
      />
    </div>
  );
};

export { PocketList };
