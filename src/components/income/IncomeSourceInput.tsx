import React, { useState, useEffect, useRef } from 'react';
import { DEFAULT_SOURCE_PRESETS, getSourceEmoji, saveSourceEmoji } from '../../lib/income-sources';
import { getTablerIconByEmoji } from '../../lib/icons-map';
import { useIncomeStore } from '../../store/useIncomeStore';
import { cn } from '../../lib/utils';

interface IncomeSourceInputProps {
  value: string;
  onChange: (val: string) => void;
  error?: string;
}

export const IncomeSourceInput: React.FC<IncomeSourceInputProps> = ({ value, onChange, error }) => {
  const { incomes } = useIncomeStore();
  const [isOpen, setIsOpen] = useState(false);
  const [userTyped, setUserTyped] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [, setEmojiTrigger] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const suggestions = React.useMemo(() => {
    const defaultLabels = DEFAULT_SOURCE_PRESETS.map((p) => p.label);
    const usedLabels = incomes.map((i) => i.source_type).filter(Boolean);
    return Array.from(new Set([...defaultLabels, ...usedLabels]));
  }, [incomes]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setShowPicker(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const filtered = userTyped ? suggestions.filter((s) => s.toLowerCase().includes(value.toLowerCase())) : suggestions;

  // React to the trigger state or external source value changes
  const emoji = getSourceEmoji(value);

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Label */}
      <p className={`text-[11px] font-medium mb-1.5 ${error ? 'text-red-400' : 'text-white/40'}`}>Source</p>

      {/* Input */}
      <div className="relative flex items-center">
        <input
          type="text"
          value={value}
          placeholder="Source for this income…"
          className={`slim-input pr-16 ${error ? 'border-red-500/50' : ''}`}
          onFocus={() => {
            setIsOpen(true);
            setUserTyped(false);
            setShowPicker(false);
          }}
          onChange={(e) => {
            setUserTyped(true);
            onChange(e.target.value);
          }}
        />
        {emoji && (
          <button
            type="button"
            disabled={!value.trim()}
            onClick={(e) => {
              e.stopPropagation();
              setShowPicker(!showPicker);
              setIsOpen(false);
            }}
            className={cn(
              "absolute right-2 px-1.5 py-0.5 h-6 rounded-md bg-white/[0.04] border border-white/[0.1] hover:bg-white/[0.08] hover:border-white/20 hover:text-white active:scale-95 text-white/50 transition-all flex items-center gap-1 cursor-pointer disabled:opacity-30 disabled:pointer-events-none"
            )}
            title={value.trim() ? "Choose custom icon for this source" : "Type a source to select an icon"}
          >
            {React.createElement(getTablerIconByEmoji(emoji), { size: 12, className: "shrink-0" })}
            <span className="text-[8px] font-bold tracking-widest text-white/35">ICON</span>
          </button>
        )}
      </div>

      {error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}

      {/* Dropdown suggestions */}
      {isOpen && filtered.length > 0 && (
        <div className="absolute left-0 right-0 mt-1.5 z-50 rounded-xl bg-[#1c1c1c] border border-white/[0.08] shadow-2xl shadow-black/60 max-h-48 overflow-y-auto">
          {filtered.map((label) => {
            const e = getSourceEmoji(label);
            return (
              <button
                key={label}
                type="button"
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm text-white/75 hover:bg-white/[0.05] hover:text-white/95 transition-colors border-b border-white/[0.04] last:border-b-0"
                onClick={() => {
                  onChange(label);
                  setIsOpen(false);
                  setUserTyped(false);
                }}
              >
                <span className="w-5 flex justify-center shrink-0 text-white/50">
                  {React.createElement(getTablerIconByEmoji(e), { size: 14, className: "shrink-0" })}
                </span>
                <span className="font-medium">{label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Icon Picker Popover */}
      {showPicker && value.trim() && (
        <div className="absolute right-0 mt-1.5 z-50 p-2.5 w-48 rounded-2xl bg-[#1c1c1c] border border-[#ffffff]/[0.08] shadow-2xl shadow-black/80">
          <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest px-2 mb-2">Select Icon</p>
          <div className="grid grid-cols-5 gap-1.5">
            {['🏢', '💼', '🪂', '📊', '💧', '🔒', '📈', '🎁', '💵', '₿', '✨', '⚡', '🛍️', '🎮', '✈️', '🐾', '🌿', '🍜', '🤲'].map((item) => {
              const IconComponent = getTablerIconByEmoji(item);
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    saveSourceEmoji(value, item);
                    setEmojiTrigger((prev) => prev + 1);
                    setShowPicker(false);
                  }}
                  className={cn(
                    "h-7 w-7 rounded-lg flex items-center justify-center text-white/50 hover:text-white/90 hover:bg-[#ffffff]/[0.04] active:scale-90 transition-all cursor-pointer",
                    emoji === item && "text-white bg-white/10 border border-white/20"
                  )}
                >
                  {React.createElement(IconComponent, { size: 14, className: "shrink-0" })}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
