import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { useAuthStore } from '../store/useAuthStore';

// ============================================================
//  LOGIN PAGE — Neo-brutal, full-page, no sidebar
// ============================================================

const LoginPage: React.FC = () => {
  useEffect(() => {
    document.title = 'Masuk';
    return () => { document.title = 'Keuanganku'; };
  }, []);

  const { login, isLoading, error, clearError } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    await login(email, password);
  };

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-4 py-12"
      style={{ backgroundColor: '#1A1A1A' }}
    >
      {/* Card */}
      <div
        className="w-full max-w-sm border-3 border-[#555555] !shadow-[5px_5px_0_0_#000000]"
        style={{ backgroundColor: '#242424', boxShadow: '5px 5px 0px 0px #F5F0E8' }}
      >
        {/* Header */}
        <div
          className="px-6 py-5 border-b-4 border-[#F5F0E8]"
          style={{ backgroundColor: '#B8F55A' }}
        >
          <h1
            className="text-2xl font-black uppercase tracking-tight"
            style={{ color: '#1A1A1A' }}
          >
            Keuangan<span style={{ color: '#1A1A1A', opacity: 0.6 }}>ku</span>
          </h1>
          <p className="text-xs font-bold uppercase tracking-widest mt-1" style={{ color: '#1A1A1A', opacity: 0.7 }}>
            Masuk ke akun kamu
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-6 space-y-4" noValidate>
          {/* Error banner */}
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
            id="login-email"
            label="Email"
            type="email"
            placeholder="kamu@email.com"
            autoComplete="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); clearError(); }}
            required
            style={{ fontSize: '16px' }}
          />

          <Input
            id="login-password"
            label="Kata Sandi"
            type={showPass ? 'text' : 'password'}
            placeholder="••••••••"
            autoComplete="current-password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); clearError(); }}
            required
            style={{ fontSize: '16px' }}
            rightSection={
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                aria-label={showPass ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                className="pointer-events-auto"
              >
                {showPass
                  ? <EyeOff size={16} strokeWidth={2.5} />
                  : <Eye size={16} strokeWidth={2.5} />}
              </button>
            }
          />

          <Button
            id="login-submit"
            type="submit"
            variant="primary"
            fullWidth
            loading={isLoading}
            leftIcon={<LogIn size={16} strokeWidth={2.5} />}
          >
            Masuk
          </Button>

          <p className="text-center text-xs font-medium" style={{ color: '#A09890' }}>
            Belum punya akun?{' '}
            <Link
              to="/register"
              className="font-bold underline underline-offset-2"
              style={{ color: '#B8F55A' }}
            >
              Daftar
            </Link>
          </p>
        </form>
      </div>

      {/* Footer */}
      <p className="mt-8 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#3A3A3A' }}>
        v0.1.0-alpha
      </p>
    </div>
  );
};

export default LoginPage;
