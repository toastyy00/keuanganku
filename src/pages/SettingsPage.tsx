import React, { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Tag,
  DollarSign, Cpu, Download, Upload, Plus, Trash2,
  CheckCircle, XCircle, RefreshCw, Loader2, ChevronDown, LogOut, User,
} from 'lucide-react';
import { Card, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { useExpenseStore } from '../store/useExpenseStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { testAiConnection } from '../lib/ai';
import { exportJSON, importJSON } from '../lib/sync';
import { downloadCSV } from '../lib/utils';
import { getExchangeRate, forceRefreshRate } from '../lib/exchangeRate';
import { useAuthStore } from '../store/useAuthStore';
import type { Currency } from '../types';

function haptic() { if ('vibrate' in navigator) navigator.vibrate(10); }

function StatusBadge({ status }: { status: 'ok' | 'fail' | 'idle' }) {
  if (status === 'idle') return null;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 border-2 border-[#555555] text-xs font-bold uppercase ${status === 'ok' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
      }`}>
      {status === 'ok'
        ? <><CheckCircle size={12} strokeWidth={2.5} /> OK</>
        : <><XCircle size={12} strokeWidth={2.5} /> FAIL</>}
    </span>
  );
}

// ── Collapsible Section ────────────────────────────────────────────
function Section({
  title,
  icon: Icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card>
      {/* Clickable header — click to toggle */}
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); haptic(); }}
        className="w-full flex items-center justify-between gap-2 px-4 py-3.5 border-b-2 border-[#3A3A3A] cursor-pointer select-none hover:bg-brutal-bone/5 transition-colors duration-150"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <Icon size={18} strokeWidth={2.5} />
          <h2 className="text-sm font-black uppercase tracking-wider">{title}</h2>
        </div>
        <ChevronDown
          size={16}
          strokeWidth={2.5}
          className="shrink-0 transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>
      {open && (
        <CardBody className="space-y-4">{children}</CardBody>
      )}
    </Card>
  );
}

const COMMON_EMOJIS = [
  '🍔', '🍕', '🍜', '🛒', '🏠', '⚡', '🚗', '💊', '🎮', '✨',
  '📺', '₿', '🎓', '💼', '🎁', '🏋️', '✈️', '🎵', '👕', '🤲',
  '📱', '👨‍👩‍👧', '🎁', '🐾', '🌿',
];

const SettingsPage: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'Settings — Keuanganku';
    return () => { document.title = 'Keuanganku'; };
  }, []);

  const { user, logout } = useAuthStore();

  const {
    expenses, categories, recurringTemplates,
    currency, setCurrency, addCategory, deleteCategory, loadExpenses,
  } = useExpenseStore();

  const {
    aiProvider, aiKey, openrouterModel,
    setAiProvider, setAiKey, setOpenrouterModel,
  } = useSettingsStore();

  const [aiStatus, setAiStatus] = useState<'ok' | 'fail' | 'idle'>('idle');
  const [aiTesting, setAiTesting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [importConfirm, setImportConfirm] = useState<string | null>(null);
  const [rateDisplay, setRateDisplay] = useState('Memuat...');
  const [rateRefreshing, setRateRefreshing] = useState(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [isLogoutLoading, setIsLogoutLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const [newCatLabel, setNewCatLabel] = useState('');
  const [newCatEmoji, setNewCatEmoji] = useState('📦');
  const [catError, setCatError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load current exchange rate for display
  useEffect(() => {
    getExchangeRate().then((r) => {
      if (r.isFallback) {
        setRateDisplay(`1 USD ≈ Rp ${r.rate.toLocaleString('id-ID')} (perkiraan offline)`);
      } else {
        setRateDisplay(`1 USD = Rp ${r.rate.toLocaleString('id-ID')}`);
      }
    });
  }, []);

  const handleCurrencyChange = (c: Currency) => { haptic(); setCurrency(c); };

  const handleTestAI = async () => {
    setAiTesting(true); setAiStatus('idle');
    const ok = await testAiConnection({ provider: aiProvider, apiKey: aiKey, openrouterModel });
    setAiStatus(ok ? 'ok' : 'fail');
    setAiTesting(false);
  };

  const handleExportCSV = () => {
    haptic();
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    downloadCSV(expenses, `keuanganku-${month}.csv`);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImportConfirm(ev.target?.result as string);
      setImportMsg('Data siap diimpor. Ini akan menimpa data lokal saat ini.');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleConfirmImport = async () => {
    if (!importConfirm) return;
    setIsImporting(true);
    setImportMsg('Mengimpor data (tunggu sebentar)...');
    try {
      await importJSON(importConfirm);
      setImportMsg('✓ Import berhasil. Memuat ulang data...');
      setImportConfirm(null);
      await loadExpenses();
      haptic();
    } catch (err) {
      setImportMsg(`✗ ${err instanceof Error ? err.message : 'Import gagal'}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleRefreshRate = async () => {
    setRateRefreshing(true);
    const r = await forceRefreshRate();
    if (r.isFallback) {
      setRateDisplay(`1 USD ≈ Rp ${r.rate.toLocaleString('id-ID')} (perkiraan offline)`);
    } else {
      setRateDisplay(`1 USD = Rp ${r.rate.toLocaleString('id-ID')}`);
    }
    setRateRefreshing(false);
    haptic();
  };

  const handleAddCategory = async () => {
    if (!newCatLabel.trim()) { setCatError('Nama kategori wajib diisi'); return; }
    const slug = newCatLabel.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (categories.some((c) => c.slug === slug)) { setCatError('Kategori sudah ada'); return; }
    try {
      await addCategory({ slug, label: newCatLabel.trim(), emoji: newCatEmoji, is_default: false });
      setNewCatLabel(''); setNewCatEmoji('📦'); setCatError('');
      haptic();
    } catch (err) {
      setCatError(err instanceof Error ? err.message : 'Gagal menambah');
    }
  };

  const handleDeleteCategory = async (slug: string) => {
    const hasExpenses = expenses.some((e) => e.category === slug);
    if (hasExpenses && !window.confirm('Kategori ini masih digunakan. Tetap hapus?')) return;
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
      <div className="section-pad max-w-2xl mx-auto space-y-4 pb-8">
        <h1 className="text-2xl font-black uppercase tracking-tight">Settings</h1>

        {/* ── AKUN ──────────────────────────────────────── */}
        <Section title="Akun" icon={User} defaultOpen={true}>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: '#A09890' }}>
                Login sebagai
              </p>
              <p className="text-sm font-bold truncate" style={{ color: '#F5F0E8' }} title={user?.email ?? ''}>
                {user?.email ?? '—'}
              </p>
            </div>
            <button
              id="settings-logout-btn"
              onClick={() => setIsLogoutModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 border-2 border-red-500 text-red-400 text-xs font-black uppercase tracking-wider hover:bg-red-500 hover:text-white transition-all duration-150 shrink-0"
            >
              <LogOut size={14} strokeWidth={2.5} />
              Keluar
            </button>
          </div>
        </Section>

        <Section title="Mata Uang Default" icon={DollarSign} defaultOpen={false}>
          <p className="text-xs font-bold text-brutal-bone-dim uppercase tracking-wider">
            Mata uang default untuk input pengeluaran baru.
          </p>
          <div className="flex border-2 border-[#555555] h-12">
            {(['IDR', 'USD'] as Currency[]).map((c) => (
              <button key={c} onClick={() => handleCurrencyChange(c)}
                className={`flex-1 flex items-center justify-center border-r-2 last:border-r-0 border-[#555555] font-black uppercase text-sm transition-all duration-150 ${currency === c ? 'bg-[#F5F0E8] text-[#1A1A1A]' : 'bg-[#2A2A2A] hover:bg-[#3A3A3A]'
                  }`}
              >
                {c === 'IDR' ? 'IDR (Rp)' : 'USD ($)'}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-brutal-bone-dim">Kurs saat ini: {rateDisplay}</p>
            <button
              onClick={handleRefreshRate}
              disabled={rateRefreshing}
              className="neo-btn neo-btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
            >
              {rateRefreshing
                ? <Loader2 size={12} strokeWidth={2.5} className="animate-spin" />
                : <RefreshCw size={12} strokeWidth={2.5} />
              }
              Perbarui
            </button>
          </div>
        </Section>

        {/* ── AI PROVIDER ─────────────────────────────── */}
        <Section title="AI Provider" icon={Cpu} defaultOpen={false}>
          <div className="flex border-2 border-[#555555] h-11">
            {(['openrouter', 'openai'] as const).map((p) => (
              <button key={p} onClick={() => setAiProvider(p)}
                className={`flex-1 text-xs font-black uppercase border-r-2 last:border-r-0 border-[#555555] transition-all duration-150 ${aiProvider === p ? 'bg-[#F5F0E8] text-[#1A1A1A]' : 'bg-[#2A2A2A] hover:bg-[#3A3A3A]'
                  }`}
              >
                {p === 'openrouter' ? 'OpenRouter' : 'OpenAI'}
              </button>
            ))}
          </div>
          <Input
            label="API Key"
            type="password"
            placeholder="sk-..."
            value={aiKey}
            onChange={(e) => setAiKey(e.target.value)}
            hint="Disimpan hanya di browser kamu. Tidak dikirim ke server manapun."
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
          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={handleTestAI} loading={aiTesting}
              leftIcon={<Cpu size={14} strokeWidth={2.5} />}>
              Test Koneksi
            </Button>
            <StatusBadge status={aiStatus} />
          </div>
        </Section>

        {/* ── BACKUP ─────────────────────────────────── */}
        <Section title="Backup & Restore" icon={Download} defaultOpen={false}>
          <div className="flex gap-3 flex-wrap">
            <Button variant="primary" leftIcon={<Download size={14} strokeWidth={2.5} />}
              onClick={() => { haptic(); exportJSON({ expenses, categories, recurring: recurringTemplates }); }}>
              Export JSON
            </Button>
            <Button variant="primary" leftIcon={<Download size={14} strokeWidth={2.5} />}
              onClick={handleExportCSV}>
              Export CSV
            </Button>
            <Button variant="secondary" leftIcon={<Upload size={14} strokeWidth={2.5} />}
              onClick={() => fileInputRef.current?.click()}>
              Import JSON
            </Button>
            <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleFileSelect} />
          </div>
          {importMsg && (
            <p className={`text-xs font-bold ${importMsg.startsWith('✓') ? 'text-green-600' : 'text-brutal-black/60'}`}>
              {importMsg}
            </p>
          )}
          {importConfirm && (
            <div className="border-2 border-[#555555] bg-[#2A2A2A] p-4 space-y-3">
              <p className="text-sm font-black uppercase">Konfirmasi Import</p>
              <p className="text-xs font-medium text-brutal-bone-dim">
                Data lokal yang ada akan ditimpa. Pastikan sudah backup terlebih dahulu.
              </p>
              <div className="flex gap-3">
                <Button variant="destructive" onClick={handleConfirmImport} loading={isImporting} fullWidth>Ya, Timpa</Button>
                <Button variant="secondary" onClick={() => { setImportConfirm(null); setImportMsg(''); }} disabled={isImporting} fullWidth>Batal</Button>
              </div>
            </div>
          )}
          <div className="space-y-1 pt-1">
            <p className="text-xs font-bold text-brutal-black/60 uppercase">Ringkasan Data</p>
            <div className="flex gap-4 text-sm">
              <span><span className="font-black">{expenses.length}</span> transaksi</span>
              <span><span className="font-black">{recurringTemplates.length}</span> rutin</span>
              <span><span className="font-black">{categories.length}</span> kategori</span>
            </div>
          </div>
        </Section>

        {/* ── CATEGORIES ─────────────────────────────── */}
        <Section title="Kategori" icon={Tag} defaultOpen={false}>
          <div className="space-y-3 p-3 border-2 border-[#555555] bg-[#2A2A2A]">
            <p className="text-xs font-black uppercase tracking-wider">Tambah Kategori Baru</p>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold uppercase tracking-wider">Emoji</label>
              <div className="flex flex-wrap gap-1">
                {COMMON_EMOJIS.map((em) => (
                  <button key={em} type="button" onClick={() => setNewCatEmoji(em)}
                    className={`w-10 h-10 text-xl flex items-center justify-center border-2 border-[#555555] transition-all duration-150 ${newCatEmoji === em ? 'bg-[#F5F0E8] text-[#1A1A1A]' : 'bg-[#1A1A1A] hover:bg-[#3A3A3A]'
                      }`}
                  >
                    {em}
                  </button>
                ))}
              </div>
            </div>
            <Input
              label="Nama Kategori"
              placeholder="Hobi, Olahraga..."
              value={newCatLabel}
              onChange={(e) => { setNewCatLabel(e.target.value); setCatError(''); }}
              error={catError}
              style={{ fontSize: '16px' }}
            />
            <Button variant="primary" leftIcon={<Plus size={14} strokeWidth={2.5} />} onClick={handleAddCategory}>
              Tambah Kategori
            </Button>
          </div>

          <div className="space-y-2">
            {categories.map((cat) => (
              <div key={cat.slug} className="flex items-center gap-3 p-3 border-2 border-[#555555] bg-[#2A2A2A]">
                <span className="text-xl w-8 text-center">{cat.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold">{cat.label}</p>
                  <p className="text-[10px] text-brutal-bone-dim font-medium">{cat.slug}</p>
                </div>
                <button
                  onClick={() => handleDeleteCategory(cat.slug)}
                  className="p-2 hover:text-red-500 hover:bg-red-50 transition-colors duration-150 min-w-[36px] min-h-[36px] flex items-center justify-center"
                  aria-label={`Hapus ${cat.label}`}
                >
                  <Trash2 size={16} strokeWidth={2.5} />
                </button>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* Logout confirmation modal */}
      <ConfirmModal
        isOpen={isLogoutModalOpen}
        title="Keluar dari Akun"
        description="Kamu akan keluar dari sesi ini. Pastikan data sudah tersimpan sebelum melanjutkan."
        confirmLabel="Ya, Keluar"
        cancelLabel="Batal"
        onConfirm={handleLogout}
        onCancel={() => setIsLogoutModalOpen(false)}
        loading={isLogoutLoading}
      />
    </>
  );
};

export default SettingsPage;
