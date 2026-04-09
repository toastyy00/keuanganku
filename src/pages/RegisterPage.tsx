import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, UserPlus, Mail } from 'lucide-react';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { useAuthStore } from '../store/useAuthStore';

// ============================================================
//  REGISTER PAGE — Neo-brutal, full-page, no sidebar
// ============================================================

const RegisterPage: React.FC = () => {
  useEffect(() => {
    document.title = 'Daftar';
    return () => { document.title = 'Keuanganku'; };
  }, []);

  const { register, isLoading, error, clearError, setRegistering } = useAuthStore();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [registered, setRegistered] = useState(false);

  // Client-side validation errors
  const [fieldErrors, setFieldErrors] = useState<{
    displayName?: string;
    email?: string;
    password?: string;
    confirmPw?: string;
  }>({});

  const validate = (): boolean => {
    const errs: typeof fieldErrors = {};
    if (!displayName.trim()) errs.displayName = 'Nama wajib diisi.';
    if (!email.trim()) errs.email = 'Email wajib diisi.';
    else if (!/\S+@\S+\.\S+/.test(email)) errs.email = 'Format email tidak valid.';
    if (!password) errs.password = 'Kata sandi wajib diisi.';
    else if (password.length < 8) errs.password = 'Kata sandi minimal 8 karakter.';
    if (!confirmPw) errs.confirmPw = 'Konfirmasi kata sandi wajib diisi.';
    else if (password !== confirmPw) errs.confirmPw = 'Kata sandi tidak cocok.';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    if (!validate()) return;
    const success = await register(email, password, displayName.trim());
    if (success) {
      setRegistered(true);
    }
  };

  // ── Success / waiting state ──────────────────────────────
  if (registered) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center px-4 py-12"
        style={{ backgroundColor: '#1A1A1A' }}
      >
        <div
          className="w-full max-w-sm border-4 border-[#F5F0E8] text-center"
          style={{ backgroundColor: '#242424', boxShadow: '5px 5px 0px px #F5F0E8' }}
        >
          {/* Yellow header */}
          <div className="px-6 py-5 border-b-4 border-[#555555]" style={{ backgroundColor: '#B8F55A' }}>
            <div className="text-4xl mb-1">📬</div>
            <h1 className="text-xl font-black uppercase tracking-tight" style={{ color: '#1A1A1A' }}>
              Pendaftaran Berhasil
            </h1>
          </div>

          <div className="px-6 py-6 space-y-4">
            <div className="border-2 border-[#555555] px-4 py-4 space-y-2 text-left">
              <p className="text-sm font-black uppercase tracking-wider" style={{ color: '#F5F0E8' }}>
                Menunggu Persetujuan Admin
              </p>
              <p className="text-xs font-medium leading-relaxed" style={{ color: '#A09890' }}>
                Akun kamu telah dibuat dan sedang menunggu konfirmasi dari admin.
                Kamu akan menerima email konfirmasi setelah disetujui.
              </p>
            </div>

            <div className="flex items-start gap-3 border-2 border-[#555555] px-4 py-3">
              <Mail size={16} strokeWidth={2.5} className="shrink-0 mt-0.5" style={{ color: '#B8F55A' }} />
              <p className="text-xs font-medium" style={{ color: '#A09890' }}>
                Cek folder <span className="font-bold" style={{ color: '#F5F0E8' }}>Inbox</span> atau{' '}
                <span className="font-bold" style={{ color: '#F5F0E8' }}>Spam</span> setelah admin
                mengkonfirmasi akun kamu.
              </p>
            </div>

            <Link
              to="/login"
              onClick={() => setRegistering(false)}
              className="block text-center text-xs font-bold underline underline-offset-2"
              style={{ color: '#B8F55A' }}
            >
              Kembali ke halaman masuk
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Registration form ────────────────────────────────────
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-4 py-12"
      style={{ backgroundColor: '#1A1A1A' }}
    >
      <div
        className="w-full max-w-sm border-3 border-[#555555] !shadow-[5px_5px_0_0_#000000]"
        style={{ backgroundColor: '#242424', boxShadow: '5px 5px 0px 0px #F5F0E8' }}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b- border-[#F5F0E8]" style={{ backgroundColor: '#B8F55A' }}>
          <h1 className="text-2xl font-black uppercase tracking-tight" style={{ color: '#1A1A1A' }}>
            Keuangan<span style={{ opacity: 0.6 }}>ku</span>
          </h1>
          <p className="text-xs font-bold uppercase tracking-widest mt-1" style={{ color: '#1A1A1A', opacity: 0.7 }}>
            Buat akun baru
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-6 space-y-4" noValidate>
          {/* Server error banner */}
          {error && (
            <div
              className="border-2 border-red-500 px-4 py-3"
              style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}
              role="alert"
            >
              <p className="text-xs font-bold text-red-400">{error}</p>
            </div>
          )}

          <Input
            id="register-name"
            label="Nama Tampilan"
            type="text"
            placeholder="Nama kamu"
            autoComplete="name"
            value={displayName}
            onChange={(e) => { setDisplayName(e.target.value); setFieldErrors((p) => ({ ...p, displayName: undefined })); clearError(); }}
            error={fieldErrors.displayName}
            required
            style={{ fontSize: '16px' }}
          />

          <Input
            id="register-email"
            label="Email"
            type="email"
            placeholder="kamu@email.com"
            autoComplete="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setFieldErrors((p) => ({ ...p, email: undefined })); clearError(); }}
            error={fieldErrors.email}
            required
            style={{ fontSize: '16px' }}
          />

          <Input
            id="register-password"
            label="Kata Sandi"
            type={showPass ? 'text' : 'password'}
            placeholder="Min. 8 karakter"
            autoComplete="new-password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setFieldErrors((p) => ({ ...p, password: undefined })); clearError(); }}
            error={fieldErrors.password}
            required
            style={{ fontSize: '16px' }}
            rightSection={
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                aria-label={showPass ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                className="pointer-events-auto"
              >
                {showPass ? <EyeOff size={16} strokeWidth={2.5} /> : <Eye size={16} strokeWidth={2.5} />}
              </button>
            }
          />

          <Input
            id="register-confirm-password"
            label="Konfirmasi Kata Sandi"
            type={showConfirm ? 'text' : 'password'}
            placeholder="Ulangi kata sandi"
            autoComplete="new-password"
            value={confirmPw}
            onChange={(e) => { setConfirmPw(e.target.value); setFieldErrors((p) => ({ ...p, confirmPw: undefined })); clearError(); }}
            error={fieldErrors.confirmPw}
            required
            style={{ fontSize: '16px' }}
            rightSection={
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                aria-label={showConfirm ? 'Sembunyikan konfirmasi' : 'Tampilkan konfirmasi'}
                className="pointer-events-auto"
              >
                {showConfirm ? <EyeOff size={16} strokeWidth={2.5} /> : <Eye size={16} strokeWidth={2.5} />}
              </button>
            }
          />

          <Button
            id="register-submit"
            type="submit"
            variant="primary"
            fullWidth
            loading={isLoading}
            leftIcon={<UserPlus size={16} strokeWidth={2.5} />}
          >
            Daftar
          </Button>

          <p className="text-center text-xs font-medium" style={{ color: '#A09890' }}>
            Sudah punya akun?{' '}
            <Link
              to="/login"
              className="font-bold underline underline-offset-2"
              style={{ color: '#B8F55A' }}
            >
              Masuk
            </Link>
          </p>
        </form>
      </div>

      <p className="mt-8 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#3A3A3A' }}>
        v0.1.0-alpha
      </p>
    </div>
  );
};

export default RegisterPage;
