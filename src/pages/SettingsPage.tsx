import React, { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Tag,
  DollarSign,
  Cpu,
  Download,
  Upload,
  Plus,
  Trash2,
  Wallet,
  CheckCircle,
  XCircle,
  RefreshCw,
  Loader2,
  ChevronDown,
  LogOut,
  User,
  ShieldCheck,
} from 'lucide-react';
import { Input } from '../components/ui/Input';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { useExpenseStore } from '../store/useExpenseStore';
import { usePortfolioStore } from '../store/usePortfolioStore';
import { useIncomeStore } from '../store/useIncomeStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { testAiConnectionDetailed } from '../lib/ai';
import { exportJSON, importJSON } from '../lib/sync';
import { downloadCSV } from '../lib/utils';
import { getExchangeRate, forceRefreshRate } from '../lib/exchangeRate';
import { useAuthStore } from '../store/useAuthStore';
import type { Currency } from '../types';

function haptic() {
  if ('vibrate' in navigator) navigator.vibrate(10);
}

function StatusBadge({ status }: { status: 'ok' | 'fail' | 'idle' }) {
  if (status === 'idle') return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${
        status === 'ok'
          ? 'bg-green-500/10 border border-green-500/30 text-green-400'
          : 'bg-red-500/10 border border-red-500/30 text-red-400'
      }`}
    >
      {status === 'ok' ? (
        <>
          <CheckCircle size={13} /> AI Connected
        </>
      ) : (
        <>
          <XCircle size={13} /> Connection Failed
        </>
      )}
    </span>
  );
}

function getScrollParent(node: HTMLElement | null): HTMLElement | Window {
  if (!node) return window;
  let parent = node.parentElement;
  while (parent) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return window;
}

// ── Collapsible Glass Section ──────────────────────────────────────────
function Section({
  sectionKey,
  title,
  icon: Icon,
  children,
  defaultOpen = false,
}: {
  sectionKey: string;
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { expandedSections, toggleSectionExpanded } = useSettingsStore();
  const isOpen = expandedSections?.[sectionKey] ?? defaultOpen;

  const handleToggle = () => {
    haptic();
    const nextState = !isOpen;
    toggleSectionExpanded(sectionKey);

    setTimeout(() => {
      if (!containerRef.current) return;
      const scrollParent = getScrollParent(containerRef.current);
      const cardRect = containerRef.current.getBoundingClientRect();
      const HEADER_OFFSET = 68; // Space for sticky top header
      const NAVBAR_OFFSET = 84; // Space for bottom navbar

      if (scrollParent === window) {
        const viewportHeight = window.innerHeight;
        const visibleHeight = viewportHeight - HEADER_OFFSET - NAVBAR_OFFSET;

        if (nextState) {
          if (cardRect.bottom > viewportHeight - NAVBAR_OFFSET) {
            const delta = cardRect.height <= visibleHeight
              ? cardRect.bottom - (viewportHeight - NAVBAR_OFFSET)
              : cardRect.top - HEADER_OFFSET;
            window.scrollBy({ top: delta, behavior: 'smooth' });
          } else if (cardRect.top < HEADER_OFFSET) {
            window.scrollBy({ top: cardRect.top - HEADER_OFFSET, behavior: 'smooth' });
          }
        } else {
          if (cardRect.top < HEADER_OFFSET) {
            window.scrollBy({ top: cardRect.top - HEADER_OFFSET, behavior: 'smooth' });
          }
        }
      } else {
        const parent = scrollParent as HTMLElement;
        const parentRect = parent.getBoundingClientRect();
        const visibleHeight = parentRect.height - HEADER_OFFSET - NAVBAR_OFFSET;

        if (nextState) {
          if (cardRect.bottom > parentRect.bottom - NAVBAR_OFFSET) {
            const delta = cardRect.height <= visibleHeight
              ? cardRect.bottom - (parentRect.bottom - NAVBAR_OFFSET)
              : cardRect.top - (parentRect.top + HEADER_OFFSET);
            parent.scrollBy({ top: delta, behavior: 'smooth' });
          } else if (cardRect.top < parentRect.top + HEADER_OFFSET) {
            parent.scrollBy({ top: cardRect.top - (parentRect.top + HEADER_OFFSET), behavior: 'smooth' });
          }
        } else {
          if (cardRect.top < parentRect.top + HEADER_OFFSET) {
            parent.scrollBy({ top: cardRect.top - (parentRect.top + HEADER_OFFSET), behavior: 'smooth' });
          }
        }
      }
    }, 200);
  };

  return (
    <div
      ref={containerRef}
      className="rounded-2xl bg-[#1E1E20]/90 border border-white/[0.08] hover:border-white/15 overflow-hidden shadow-md transition-all duration-200"
    >
      {/* Clickable Header */}
      <button
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3.5 cursor-pointer select-none hover:bg-white/[0.03] transition-colors duration-150 text-left"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center text-white/80 shrink-0">
            <Icon size={16} />
          </div>
          <h2 className="text-sm font-bold text-white tracking-wide">{title}</h2>
        </div>
        <ChevronDown
          size={16}
          className="shrink-0 text-white/40 transition-transform duration-300 ease-out"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>

      {/* Smooth CSS Grid Height & Opacity Transition */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div
            className={`px-4 pb-4 pt-1 space-y-4 border-t border-white/[0.06] transition-opacity duration-300 ease-out ${
              isOpen ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

const COMMON_EMOJIS = [
  '🍔', '🍕', '🍜', '🛒', '🏠', '⚡', '🚗', '💊', '🎮', '✨',
  '📺', '₿', '🎓', '💼', '🎁', '🏋️', '✈️', '🎵', '👕', '🤲',
  '📱', '👨‍👩‍👧', '🐾', '🌿', '☕',
];

const SettingsPage: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'Settings - KeuanganKu';
    return () => {
      document.title = 'Keuanganku';
    };
  }, []);

  const { user, logout } = useAuthStore();

  const {
    expenses,
    categories,
    recurringTemplates,
    currency,
    setCurrency,
    addCategory,
    deleteCategory,
    loadExpenses,
  } = useExpenseStore();

  const {
    pockets: portfolioPockets,
    assets: portfolioAssets,
    activityLogs: portfolioActivityLogs,
    loadPortfolio,
  } = usePortfolioStore();

  const { incomes, loadIncomes } = useIncomeStore();

  const {
    aiProvider,
    openaiKey,
    openrouterKey,
    openrouterModel,
    personalMonthlyBudget,
    familySupportMonthlyBudget,
    setAiProvider,
    setOpenaiKey,
    setOpenrouterKey,
    setOpenrouterModel,
    setPersonalMonthlyBudget,
    setFamilySupportMonthlyBudget,
  } = useSettingsStore();

  const [aiStatus, setAiStatus] = useState<'ok' | 'fail' | 'idle'>('idle');
  const [aiStatusMessage, setAiStatusMessage] = useState('');
  const [aiTesting, setAiTesting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [importConfirm, setImportConfirm] = useState<string | null>(null);
  const [rateDisplay, setRateDisplay] = useState('Loading...');
  const [rateRefreshing, setRateRefreshing] = useState(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [isLogoutLoading, setIsLogoutLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const [newCatLabel, setNewCatLabel] = useState('');
  const [newCatEmoji, setNewCatEmoji] = useState('🛍️');
  const [catError, setCatError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load current exchange rate for display
  useEffect(() => {
    getExchangeRate().then((r) => {
      if (r.isFallback) {
        setRateDisplay(`1 USD ≈ Rp ${r.rate.toLocaleString('id-ID')} (offline rate)`);
      } else {
        setRateDisplay(`1 USD = Rp ${r.rate.toLocaleString('id-ID')}`);
      }
    });
  }, []);

  useEffect(() => {
    void loadPortfolio();
    void loadIncomes();
  }, [loadPortfolio, loadIncomes]);

  const handleCurrencyChange = (c: Currency) => {
    haptic();
    setCurrency(c);
  };

  const handleBudgetChange = (
    setter: (value: number) => void,
    value: string
  ) => {
    const normalized = value.replace(/[^\d]/g, '');
    setter(normalized ? Number(normalized) : 0);
  };

  const handleTestAI = async () => {
    setAiTesting(true);
    setAiStatus('idle');
    setAiStatusMessage('');
    const apiKey = aiProvider === 'openai' ? openaiKey : openrouterKey;
    const result = await testAiConnectionDetailed({ provider: aiProvider, apiKey, openrouterModel });
    setAiStatus(result.ok ? 'ok' : 'fail');
    setAiStatusMessage(result.message);
    setAiTesting(false);
  };

  const handleExportCSV = () => {
    haptic();
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    downloadCSV(expenses, `keuanganku-${month}.csv`);
  };

  const handleExportJSON = async () => {
    haptic();
    await exportJSON({ expenses, categories, recurring: recurringTemplates, incomes });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImportConfirm(ev.target?.result as string);
      setImportMsg('Data is ready to restore. This will overwrite your current local data.');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleConfirmImport = async () => {
    if (!importConfirm) return;
    setIsImporting(true);
    setImportMsg('Restoring data...');
    try {
      await importJSON(importConfirm);
      setImportMsg('✓ Restore successful. Reloading data...');
      setImportConfirm(null);
      await loadExpenses({ force: true });
      await loadPortfolio({ force: true });
      await loadIncomes({ force: true });
      haptic();
    } catch (err) {
      setImportMsg(`✗ ${err instanceof Error ? err.message : 'Restore failed'}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleRefreshRate = async () => {
    setRateRefreshing(true);
    const r = await forceRefreshRate();
    if (r.isFallback) {
      setRateDisplay(`1 USD ≈ Rp ${r.rate.toLocaleString('id-ID')} (offline rate)`);
    } else {
      setRateDisplay(`1 USD = Rp ${r.rate.toLocaleString('id-ID')}`);
    }
    setRateRefreshing(false);
    haptic();
  };

  const handleAddCategory = async () => {
    if (!newCatLabel.trim()) {
      setCatError('Category name is required');
      return;
    }
    const slug = newCatLabel.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (categories.some((c) => c.slug === slug)) {
      setCatError('Category already exists');
      return;
    }
    try {
      await addCategory({ slug, label: newCatLabel.trim(), emoji: newCatEmoji, is_default: false });
      setNewCatLabel('');
      setNewCatEmoji('🛍️');
      setCatError('');
      haptic();
    } catch (err) {
      setCatError(err instanceof Error ? err.message : 'Failed to add category');
    }
  };

  const handleDeleteCategory = async (slug: string) => {
    const hasExpenses = expenses.some((e) => e.category === slug);
    if (hasExpenses && !window.confirm('This category is currently in use. Delete anyway?')) return;
    haptic();
    await deleteCategory(slug);
  };

  const handleLogout = async () => {
    setIsLogoutLoading(true);
    await logout();
    navigate('/login', { replace: true });
    setIsLogoutLoading(false);
    setIsLogoutModalOpen(false);
  };

  return (
    <>
      <div className="section-pad max-w-2xl mx-auto space-y-4 pb-24">
        {/* Sticky Header */}
        <div className="sticky top-0 z-20 bg-[#1A1A1A]/95 backdrop-blur-md pb-3 pt-3 -mx-4 px-4 border-b border-white/[0.08]">
          <h1 className="text-xl font-black uppercase tracking-tight text-white">Settings</h1>
          <p className="text-[11px] text-white/40 font-medium">Manage your account, currency preferences, and system settings</p>
        </div>

        {/* ── ACCOUNT HERO CARD ───────────────────────────── */}
        <div className="rounded-2xl bg-gradient-to-br from-[#242428] via-[#1E1E20] to-[#18181A] border border-white/10 p-4 shadow-xl">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 rounded-2xl bg-[#B8F55A]/10 border border-[#B8F55A]/30 flex items-center justify-center text-[#B8F55A] shrink-0 shadow-inner">
                <User size={22} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                  Signed in as
                </p>
                <p className="text-sm font-bold text-white truncate" title={user?.email ?? ''}>
                  {user?.email ?? '—'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  haptic();
                  navigate('/approval');
                }}
                className="px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/10 border border-white/10 text-white/80 hover:text-white text-xs font-semibold transition-all flex items-center gap-1.5 active:scale-95"
              >
                <ShieldCheck size={14} className="text-[#5B9CF6]" /> Admin
              </button>
              <button
                id="settings-logout-btn"
                type="button"
                onClick={() => setIsLogoutModalOpen(true)}
                className="px-3.5 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-bold transition-all flex items-center gap-1.5 active:scale-95"
              >
                <LogOut size={14} /> Sign Out
              </button>
            </div>
          </div>
        </div>

        {/* ── DEFAULT CURRENCY ────────────────────────────── */}
        <Section sectionKey="currency" title="Default Currency" icon={DollarSign} defaultOpen={false}>
          <p className="text-xs text-white/50 font-medium">
            Select your primary currency for recording new transactions.
          </p>

          {/* Segmented Pill Switcher */}
          <div className="relative grid w-full grid-cols-2 rounded-xl bg-white/[0.05] p-1 border border-white/[0.06]">
            {(['IDR', 'USD'] as Currency[]).map((c) => {
              const isActive = currency === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => handleCurrencyChange(c)}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition-all duration-200 ${
                    isActive
                      ? 'bg-white text-[#1A1A1A] shadow-sm'
                      : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  {c === 'IDR' ? 'IDR (Rupiah)' : 'USD (Dollar)'}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-white/40 font-medium">{rateDisplay}</p>
            <button
              type="button"
              onClick={handleRefreshRate}
              disabled={rateRefreshing}
              className="px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/10 border border-white/10 text-white/80 text-xs font-medium flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
            >
              {rateRefreshing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              Refresh Rate
            </button>
          </div>
        </Section>

        {/* ── MONTHLY BUDGET ──────────────────────────────── */}
        <Section sectionKey="budget" title="Monthly Budget" icon={Wallet} defaultOpen={false}>
          <p className="text-xs text-white/50 font-medium">
            Reference budgets used for personal and family expense insights.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label={`Personal Budget (${currency})`}
              type="text"
              inputMode="numeric"
              placeholder={currency === 'IDR' ? '0' : '125'}
              value={personalMonthlyBudget ? String(personalMonthlyBudget) : ''}
              onChange={(e) => handleBudgetChange(setPersonalMonthlyBudget, e.target.value)}
              hint="Estimated personal expenses & wants."
              style={{ fontSize: '16px' }}
            />
            <Input
              label={`Family Support Budget (${currency})`}
              type="text"
              inputMode="numeric"
              placeholder={currency === 'IDR' ? '0' : '95'}
              value={familySupportMonthlyBudget ? String(familySupportMonthlyBudget) : ''}
              onChange={(e) => handleBudgetChange(setFamilySupportMonthlyBudget, e.target.value)}
              hint="Regular support for parents or family."
              style={{ fontSize: '16px' }}
            />
          </div>
        </Section>

        {/* ── AI PROVIDER ─────────────────────────────────── */}
        <Section sectionKey="ai" title="AI Provider Settings" icon={Cpu} defaultOpen={false}>
          {/* Segmented Pill Switcher */}
          <div className="relative grid w-full grid-cols-2 rounded-xl bg-white/[0.05] p-1 border border-white/[0.06]">
            {(['openrouter', 'openai'] as const).map((p) => {
              const isActive = aiProvider === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setAiProvider(p)}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition-all duration-200 ${
                    isActive
                      ? 'bg-white text-[#1A1A1A] shadow-sm'
                      : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  {p === 'openrouter' ? 'OpenRouter' : 'OpenAI'}
                </button>
              );
            })}
          </div>

          <Input
            label={aiProvider === 'openai' ? 'OpenAI API Key' : 'OpenRouter API Key'}
            type="password"
            placeholder="sk-..."
            value={aiProvider === 'openai' ? openaiKey : openrouterKey}
            onChange={(e) =>
              aiProvider === 'openai' ? setOpenaiKey(e.target.value) : setOpenrouterKey(e.target.value)
            }
            hint="API keys are stored securely in your browser."
            style={{ fontSize: '16px' }}
          />

          {aiProvider === 'openrouter' && (
            <Input
              label="Model"
              placeholder="mistralai/mistral-7b-instruct:free"
              value={openrouterModel}
              onChange={(e) => setOpenrouterModel(e.target.value)}
              style={{ fontSize: '16px' }}
            />
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleTestAI}
              disabled={aiTesting}
              className="h-9 px-4 rounded-xl bg-[#B8F55A] hover:bg-[#B8F55A]/90 text-[#1A1A1A] font-bold text-xs transition-all active:scale-95 flex items-center gap-1.5 shadow-md disabled:opacity-50"
            >
              {aiTesting ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Cpu size={13} />
              )}
              Test Connection
            </button>
            <StatusBadge status={aiStatus} />
          </div>

          {aiStatusMessage && (
            <p className={`text-xs font-bold ${aiStatus === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
              {aiStatusMessage}
            </p>
          )}
        </Section>

        {/* ── BACKUP & RESTORE ────────────────────────────── */}
        <Section sectionKey="backup" title="Data Backup & Restore" icon={Download} defaultOpen={false}>
          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => {
                void handleExportJSON();
              }}
              className="py-2 px-1.5 rounded-xl bg-white/[0.05] hover:bg-white/10 border border-white/10 text-white font-semibold text-[11px] transition-all flex items-center justify-center gap-1 active:scale-95"
            >
              <Download size={12} className="text-white/60 shrink-0" />
              <span className="truncate">Backup JSON</span>
            </button>
            <button
              type="button"
              onClick={handleExportCSV}
              className="py-2 px-1.5 rounded-xl bg-white/[0.05] hover:bg-white/10 border border-white/10 text-white font-semibold text-[11px] transition-all flex items-center justify-center gap-1 active:scale-95"
            >
              <Download size={12} className="text-white/60 shrink-0" />
              <span className="truncate">Backup CSV</span>
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="py-2 px-1.5 rounded-xl bg-[#B8F55A]/10 hover:bg-[#B8F55A]/20 border border-[#B8F55A]/30 text-[#B8F55A] font-semibold text-[11px] transition-all flex items-center justify-center gap-1 active:scale-95"
            >
              <Upload size={12} className="shrink-0" />
              <span className="truncate">Restore JSON</span>
            </button>
            <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleFileSelect} />
          </div>

          {importMsg && (
            <p className={`text-[11px] font-bold ${importMsg.startsWith('✓') ? 'text-green-400' : 'text-white/60'}`}>
              {importMsg}
            </p>
          )}

          {importConfirm && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 space-y-2">
              <p className="text-[11px] font-bold text-red-400 uppercase tracking-wide">Confirm Restore</p>
              <p className="text-[11px] text-white/70">
                Your current local data will be overwritten. Make sure you have created a backup before proceeding.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleConfirmImport}
                  disabled={isImporting}
                  className="flex-1 py-1 rounded-lg bg-red-500 text-white font-bold text-[11px] hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  {isImporting ? 'Restoring...' : 'Overwrite & Restore'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setImportConfirm(null);
                    setImportMsg('');
                  }}
                  disabled={isImporting}
                  className="flex-1 py-1 rounded-lg bg-white/10 text-white font-semibold text-[11px] hover:bg-white/20 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Stored Data Summary — Single Master Glass Table */}
          <div className="space-y-1.5 pt-1">
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3 space-y-2.5">
              <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Stored Data Summary</p>
                <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-white/50">
                  8 Data Domains
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 divide-x divide-white/[0.06]">
                {/* Column 1: Expenses */}
                <div className="space-y-1.5 pr-1">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">Expenses</p>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-white/50">Expenses</span>
                      <span className="font-bold text-white">{expenses.length}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-white/50">Recurring</span>
                      <span className="font-bold text-white">{recurringTemplates.length}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-white/50">Categories</span>
                      <span className="font-bold text-white">{categories.length}</span>
                    </div>
                  </div>
                </div>

                {/* Column 2: Income */}
                <div className="space-y-1.5 px-2">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">Income</p>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-white/50">Records</span>
                      <span className="font-bold text-white">{incomes.length}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-white/50">Sources</span>
                      <span className="font-bold text-white">{new Set(incomes.map((i) => i.source_type)).size}</span>
                    </div>
                  </div>
                </div>

                {/* Column 3: Portfolio */}
                <div className="space-y-1.5 pl-2">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">Portfolio</p>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-white/50">Pockets</span>
                      <span className="font-bold text-white">{portfolioPockets.length}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-white/50">Assets</span>
                      <span className="font-bold text-white">{portfolioAssets.length}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-white/50">Logs</span>
                      <span className="font-bold text-white">{portfolioActivityLogs.length}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Section>

        {/* ── CATEGORIES ─────────────────────────────────── */}
        <Section sectionKey="categories" title="Categories" icon={Tag} defaultOpen={false}>
          {/* Add Category Form Card */}
          <div className="space-y-3 p-3.5 rounded-xl border border-white/[0.08] bg-white/[0.03]">
            <p className="text-xs font-bold text-white uppercase tracking-wider">Add New Category</p>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-white/40">Select Emoji</label>
              <div className="flex flex-wrap gap-1.5">
                {COMMON_EMOJIS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => setNewCatEmoji(em)}
                    className={`w-9 h-9 text-lg flex items-center justify-center rounded-xl border transition-all duration-150 active:scale-95 ${
                      newCatEmoji === em
                        ? 'bg-white text-[#1A1A1A] border-white shadow-sm'
                        : 'bg-white/[0.05] border-white/10 hover:bg-white/10 text-white'
                    }`}
                  >
                    {em}
                  </button>
                ))}
              </div>
            </div>

            <Input
              label="Category Name"
              placeholder="e.g. Hobbies, Fitness..."
              value={newCatLabel}
              onChange={(e) => {
                setNewCatLabel(e.target.value);
                setCatError('');
              }}
              error={catError}
              style={{ fontSize: '16px' }}
            />

            <button
              type="button"
              onClick={handleAddCategory}
              className="h-9 px-4 rounded-xl bg-[#B8F55A] hover:bg-[#B8F55A]/90 text-[#1A1A1A] font-bold text-xs transition-all active:scale-95 inline-flex items-center gap-1.5 shadow-md"
            >
              <Plus size={14} strokeWidth={2.5} /> Add Category
            </button>
          </div>

          {/* Category Items List */}
          <div className="space-y-2 pt-1">
            {categories.map((cat) => (
              <div
                key={cat.slug}
                className="flex items-center gap-3 p-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
              >
                <span className="text-xl w-8 text-center shrink-0">{cat.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-white truncate">{cat.label}</p>
                  <p className="text-[10px] text-white/40 font-medium truncate">{cat.slug}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteCategory(cat.slug)}
                  className="w-8 h-8 rounded-lg hover:bg-red-500/20 text-white/40 hover:text-red-400 transition-colors flex items-center justify-center shrink-0"
                  aria-label={`Delete ${cat.label}`}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* Logout confirmation modal */}
      <ConfirmModal
        isOpen={isLogoutModalOpen}
        title="Sign Out"
        description="Are you sure you want to sign out? Make sure your data is saved before proceeding."
        confirmLabel="Sign Out"
        cancelLabel="Cancel"
        onConfirm={handleLogout}
        onCancel={() => setIsLogoutModalOpen(false)}
        loading={isLogoutLoading}
      />
    </>
  );
};

export default SettingsPage;
