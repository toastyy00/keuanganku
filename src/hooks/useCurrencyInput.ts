import { useCallback, useEffect, useRef, useState } from 'react';
import type { Currency } from '../types';

// ============================================================
//  useCurrencyInput — live-formatted currency amount input
// ============================================================

export interface CurrencyInputResult {
  /** Formatted display string (e.g. "1.500.000" or "1,500.00") */
  displayValue: string;
  /** Raw numeric value (always the source of truth) */
  rawValue: number;
  /** Call this on onChange — handles stripping and re-formatting */
  handleChange: (input: string) => void;
  /** Programmatically set a raw number and format it for display */
  setFromNumber: (num: number) => void;
  /** Reset to empty state */
  reset: () => void;
}

function formatIDR(num: number): string {
  if (!num || isNaN(num)) return '';
  return Math.round(num).toLocaleString('id-ID');
}

function formatUSD(num: number): string {
  if (!num || isNaN(num)) return '';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Reusable hook for currency amount inputs.
 *
 * - Strips non-digit characters on each keystroke.
 * - IDR: formats as "1.500.000" (dot-thousands, no decimals).
 * - USD: formats as "1,500.00" (comma-thousands, 2 decimals).
 * - rawValue is always a clean number — use this for saving.
 * - When `currency` prop changes, setFromNumber re-formats the current rawValue.
 */
export function useCurrencyInput(currency: Currency): CurrencyInputResult {
  const [rawValue, setRawValue] = useState(0);
  const [displayValue, setDisplayValue] = useState('');

  // Keep currency in a ref so callbacks always see the latest value.
  const currencyRef = useRef<Currency>(currency);
  useEffect(() => {
    currencyRef.current = currency;
  });

  const handleChange = useCallback((input: string): void => {
    const curr = currencyRef.current;

    if (curr === 'IDR') {
      // Strip everything except digits
      const digits = input.replace(/[^\d]/g, '');
      const num = digits ? parseInt(digits, 10) : 0;
      setRawValue(num);
      setDisplayValue(num ? formatIDR(num) : '');
    } else {
      // USD: allow digits and one decimal point
      const stripped = input.replace(/[^0-9.]/g, '');
      // Collapse multiple dots
      const dotIdx = stripped.indexOf('.');
      const cleaned =
        dotIdx >= 0
          ? stripped.slice(0, dotIdx + 1) +
            stripped.slice(dotIdx + 1).replace(/\./g, '').slice(0, 2)
          : stripped;

      const num = cleaned ? parseFloat(cleaned) : 0;
      setRawValue(isNaN(num) ? 0 : num);

      // Preserve in-progress decimal state (e.g. "15." or "15.5")
      const parts = cleaned.split('.');
      let formatted = parts[0] ? parseInt(parts[0], 10).toLocaleString('en-US') : '';
      if (parts.length > 1) {
        formatted += '.' + parts[1]; // keep whatever fractional part they typed
      }
      setDisplayValue(formatted || (cleaned ? '0' : ''));
    }
  }, []);

  const setFromNumber = useCallback((num: number): void => {
    const curr = currencyRef.current;
    setRawValue(num);
    if (curr === 'IDR') {
      setDisplayValue(num > 0 ? formatIDR(num) : '');
    } else {
      setDisplayValue(num > 0 ? formatUSD(num) : '');
    }
  }, []);

  const reset = useCallback((): void => {
    setRawValue(0);
    setDisplayValue('');
  }, []);

  return { displayValue, rawValue, handleChange, setFromNumber, reset };
}
