import React, { useState } from 'react';
import { createClient, type User } from '@supabase/supabase-js';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { ShieldCheck, UserCheck, XCircle } from 'lucide-react';
import { appConfig } from '../lib/appConfig';

// ============================================================
//  ADMIN APPROVAL PAGE
//  Uses localStorage to save the Service Role Key safely
//  on your browser ONLY. Tidak dibundel ke publik!
// ============================================================

const supabaseUrl = appConfig.supabaseUrl ?? '';
type PendingUser = Pick<User, 'id' | 'email' | 'user_metadata'>;

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Gagal terhubung. Pastikan Service Role Key benar.';
}

export default function AdminApprovalPage() {
  const [serviceKey, setServiceKey] = useState(() => localStorage.getItem('keauanganku_admin_key') || '');
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isConnected, setIsConnected] = useState(false);

  const connectAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!serviceKey) {
      setError('Masukkan Service Role Key');
      return;
    }

    setIsLoading(true);
    try {
      // Simpan key ke localStorage agar tidak repot ketik ulang nanti
      localStorage.setItem('keauanganku_admin_key', serviceKey);

      const adminClient = createClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // Uji coba ambil user
      const { data, error: fetchErr } = await adminClient.auth.admin.listUsers();
      if (fetchErr) throw fetchErr;

      setIsConnected(true);

      // Filter yang belum di-approve
      const pending = data.users.filter(
        (u) => u.user_metadata?.is_approved === false
      );
      setUsers(pending);
    } catch (err) {
      setError(getErrorMessage(err));
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  };

  const approveUser = async (userId: string, currentMeta: PendingUser['user_metadata']) => {
    setError('');
    setSuccessMsg('');
    setIsLoading(true);
    try {
      const adminClient = createClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { error: updateErr } = await adminClient.auth.admin.updateUserById(userId, {
        user_metadata: { ...currentMeta, is_approved: true },
      });

      if (updateErr) throw updateErr;

      setSuccessMsg('User berhasil disetujui!');
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col items-center p-4 py-8" style={{ backgroundColor: '#1A1A1A' }}>
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="border-3 border-[#F5F0E8] p-4 text-center" style={{ backgroundColor: '#B8F55A', boxShadow: '4px 4px 0px 0px #F5F0E8' }}>
          <div className="flex justify-center mb-2">
            <ShieldCheck size={32} style={{ color: '#1A1A1A' }} />
          </div>
          <h1 className="text-xl font-black uppercase tracking-tight" style={{ color: '#1A1A1A' }}>
            Admin Dashboard
          </h1>
          <p className="text-xs font-bold mt-1" style={{ color: '#1A1A1A', opacity: 0.8 }}>
            Penyetujuan Akun Pendaftar
          </p>
        </div>

        {/* Error / Success Messages */}
        {error && (
          <div className="border-2 border-red-500 bg-red-500/10 p-3 text-red-500 text-sm font-bold flex items-center gap-2">
            <XCircle size={16} /> {error}
          </div>
        )}
        {successMsg && (
          <div className="border-2 border-green-500 bg-green-500/10 p-3 text-green-500 text-sm font-bold flex items-center gap-2">
            <UserCheck size={16} /> {successMsg}
          </div>
        )}

        {/* Connection Form */}
        {!isConnected ? (
          <form onSubmit={connectAdmin} className="border-3 border-[#555555] p-5 space-y-4" style={{ backgroundColor: '#242424' }}>
            <p className="text-xs text-[#A09890] mb-4 font-medium leading-relaxed">
              Silakan masukkan "service_role" key. Key ini akan disimpan secara otomatis di <strong className="text-[#F5F0E8]">Browser Anda</strong>, jadi Anda tidak perlu mengetiknya lagi besok-besok.
            </p>
            <Input
              id="service-key"
              type="password"
              label="Service Role Key"
              placeholder="eyJhbG..."
              value={serviceKey}
              onChange={(e) => setServiceKey(e.target.value)}
              required
            />
            <Button type="submit" loading={isLoading} fullWidth>
              Koneksikan & Ambil Data
            </Button>
          </form>
        ) : (
          /* User List */
          <div className="space-y-4">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-[#F5F0E8] font-bold">Menunggu Persetujuan ({users.length})</h2>
              <button
                onClick={() => {
                  setIsConnected(false);
                  setServiceKey('');
                  localStorage.removeItem('keauanganku_admin_key');
                }}
                className="text-xs text-[#B8F55A] underline font-bold"
              >
                Hapus Key & Keluar
              </button>
            </div>

            {users.length === 0 ? (
              <div className="border-3 border-[#555555] p-6 text-center text-[#A09890] font-medium" style={{ backgroundColor: '#242424' }}>
                Tidak ada user yang menunggu persetujuan.
              </div>
            ) : (
              users.map((user) => (
                <div key={user.id} className="border-3 border-[#555555] p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4" style={{ backgroundColor: '#242424' }}>
                  <div className="overflow-hidden w-full">
                    <p className="text-[#F5F0E8] font-bold truncate">
                      {user.user_metadata?.display_name || 'Tanpa Nama'}
                    </p>
                    <p className="text-xs text-[#A09890] truncate">{user.email}</p>
                    <p className="text-[10px] text-[#A09890] mt-1">ID: {user.id.substring(0, 8)}...</p>
                  </div>
                  <Button
                    onClick={() => approveUser(user.id, user.user_metadata)}
                    loading={isLoading}
                    className="shrink-0 w-full sm:w-auto"
                    style={{ backgroundColor: '#4CAF50', borderColor: '#4CAF50', color: 'white' }}
                  >
                    Setujui Akun
                  </Button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
