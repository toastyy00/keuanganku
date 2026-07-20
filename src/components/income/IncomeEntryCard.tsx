import React from 'react';
import { useUIStore } from '../../store/useAppStore';
import { getSourceEmoji } from '../../lib/income-sources';
import { getTablerIconByEmoji } from '../../lib/icons-map';
import type { IncomeEntry } from '../../types';

interface IncomeEntryCardProps {
  income: IncomeEntry;
}

export const IncomeEntryCard: React.FC<IncomeEntryCardProps> = ({ income }) => {
  const { openIncomeDetailSheet } = useUIStore();

  const handleCardClick = () => {
    openIncomeDetailSheet(income.id);
  };

  const emoji = getSourceEmoji(income.source_type);

  // Date formatting
  const formattedDate = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${income.date}T00:00:00`));

  // PnL Calculations
  const hasCost = income.has_cost_basis && income.cost_amount !== undefined;
  const costValUsd = income.cost_value_usd ?? 0;
  const costValIdr = income.cost_value_idr ?? 0;
  const pnlUsd = income.value_usd - costValUsd;
  const pnlIdr = income.value_idr - costValIdr;
  const pnlTokens = income.asset_type !== 'FIAT'
    ? income.amount - (income.cost_amount ?? 0)
    : null;

  const [isHovered, setIsHovered] = React.useState(false);

  return (
    <div
      onClick={handleCardClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="cursor-pointer select-none flex flex-col gap-1 p-3.5 px-4 rounded-2xl transition-all duration-200 active:scale-[0.99]"
      style={{
        background: isHovered ? '#1F1F1F' : '#1A1A1A',
        boxShadow: isHovered
          ? 'inset 1px 1px 0px 0px rgba(255, 255, 255, 0.05), -4px -4px 12px rgba(255, 255, 255, 0.03), 4px 4px 12px rgba(0, 0, 0, 0.45)'
          : 'inset 1px 1px 0px 0px rgba(255, 255, 255, 0.03), -4px -4px 12px rgba(255, 255, 255, 0.03), 4px 4px 12px rgba(0, 0, 0, 0.45)',
      }}
    >
      <div className="flex justify-between items-center gap-4">
        {/* Left Info: Icon & (Title & Date) */}
        <div className="min-w-0 flex-1 flex items-center gap-3">
          <div
            className="flex items-center justify-center w-8 h-8 rounded-xl text-white/70 shrink-0"
            style={{
              background: isHovered ? '#1F1F1F' : '#1A1A1A',
              boxShadow: 'inset -2px -2px 6px rgba(255, 255, 255, 0.015), inset 2px 2px 6px rgba(0, 0, 0, 0.5)'
            }}
          >
            {React.createElement(getTablerIconByEmoji(emoji), { size: 14, className: "shrink-0" })}
          </div>
          <div className="min-w-0 flex flex-col gap-0.5">
            <h4 className="text-sm font-semibold truncate text-white/95 leading-snug">{income.title}</h4>
            <span className="text-[10px] text-white/35 font-medium">{formattedDate}</span>
          </div>
        </div>

        {/* Right side amount (Net Profit if hasCost is true, otherwise Total Received) */}
        <div className="flex items-center gap-2 shrink-0">
          {hasCost ? (
            /* Render Net Profit value */
            <div className="text-right flex flex-col gap-0.5">
              {income.asset_type === 'FIAT' ? (
                <>
                  <p className={`text-sm font-bold ${pnlUsd >= 0 ? 'text-white/90' : 'text-red-400'}`}>
                    {pnlIdr >= 0 ? '+' : ''}Rp {pnlIdr.toLocaleString('id-ID')}
                  </p>
                  <p className={`text-[10px] font-medium ${pnlUsd >= 0 ? 'text-white/50' : 'text-red-400/70'}`}>
                    {pnlUsd >= 0 ? '+' : ''}${pnlUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                </>
              ) : (
                <>
                  <p className={`text-sm font-bold ${pnlUsd >= 0 ? 'text-[#B8F55A]/80' : 'text-red-400/80'}`}>
                    {pnlTokens !== null && (pnlTokens >= 0 ? '+' : '')}
                    {pnlTokens?.toLocaleString('en-US', { maximumFractionDigits: 6 })} {income.ticker}
                  </p>
                  <p className={`text-[10px] font-medium ${pnlUsd >= 0 ? 'text-white/50' : 'text-red-400/70'}`}>
                    {pnlUsd >= 0 ? '+' : ''}${pnlUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    <span className="text-white/30 font-medium ml-1">
                      (≈ Rp {pnlIdr.toLocaleString('id-ID')})
                    </span>
                  </p>
                </>
              )}
            </div>
          ) : (
            /* Render Total Received value */
            <div className="text-right flex flex-col gap-0.5">
              {income.asset_type === 'FIAT' ? (
                <>
                  <p className="text-sm font-semibold text-white/90">
                    {income.currency === 'IDR'
                      ? `Rp ${income.amount.toLocaleString('id-ID')}`
                      : `$${income.amount.toLocaleString('en-US')}`}
                  </p>
                  <p className="text-[10px] text-white/45 font-medium">
                    {income.currency === 'IDR'
                      ? `$${income.value_usd.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                      : `Rp ${income.value_idr.toLocaleString('id-ID')}`}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-[#B8F55A]/80">
                    {income.amount.toLocaleString('en-US', { maximumFractionDigits: 6 })} {income.ticker}
                  </p>
                  <p className="text-[10px] text-white/45 font-medium">
                    ${income.value_usd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    <span className="text-white/20 font-medium ml-1">
                      (≈ Rp {income.value_idr.toLocaleString('id-ID')})
                    </span>
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </div>

    </div>
  );
};
