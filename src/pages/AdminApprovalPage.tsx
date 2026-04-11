import { useState, useEffect } from 'react';
import { Button } from '../components/ui/Button';
import { ShieldCheck, UserCheck, XCircle } from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';
import { useNavigate } from 'react-router-dom';

// ============================================================
//  ADMIN APPROVAL PAGE
//  Secured via Supabase RPC and is_admin flag in profiles table
// ============================================================

interface PendingUser {
  id: string;
  email: string;
  display_name: string;
}

export default function AdminApprovalPage() {
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  
  const { session } = useAuthStore();
  const navigate = useNavigate();

  const loadPendingUsers = async () => {
    setIsLoading(true);
    setError('');
    
    try {
      const client = getSupabaseClient();
      if (!client) throw new Error('Supabase client tidak tersedia.');

      const { data, error: fetchErr } = await client.rpc('get_pending_users');
      
      if (fetchErr) {
        throw new Error(fetchErr.message || 'Gagal memuat daftar user. Apakah Anda Admin?');
      }

      setUsers(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan tidak dikenal.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!session) {
      navigate('/login');
      return;
    }
    loadPendingUsers();
  }, [session, navigate]);

  const approveUser = async (userId: string) => {
    setError('');
    setSuccessMsg('');
    setIsLoading(true);
    try {
      const client = getSupabaseClient();
      if (!client) throw new Error('Supabase client tidak tersedia.');

      const { error: updateErr } = await client.rpc('approve_user', {
        target_user_id: userId
      });

      if (updateErr) {
        throw new Error(updateErr.message || 'Gagal menyetujui user.');
      }

      setSuccessMsg('User berhasil disetujui!');
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan tidak dikenal.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!session) return null;

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

        {/* Action Bar */}
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-[#F5F0E8] font-bold">Menunggu Persetujuan ({users.length})</h2>
          <button
            onClick={loadPendingUsers}
            className="text-xs text-[#B8F55A] underline font-bold"
          >
            Muat Ulang
          </button>
        </div>

        {/* User List */}
        <div className="space-y-4">
          {isLoading && users.length === 0 ? (
            <div className="border-3 border-[#555555] p-6 text-center text-[#A09890] font-medium" style={{ backgroundColor: '#242424' }}>
              Memuat data...
            </div>
          ) : users.length === 0 ? (
            <div className="border-3 border-[#555555] p-6 text-center text-[#A09890] font-medium" style={{ backgroundColor: '#242424' }}>
              Tidak ada user yang menunggu persetujuan.
            </div>
          ) : (
            users.map((user) => (
              <div key={user.id} className="border-3 border-[#555555] p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4" style={{ backgroundColor: '#242424' }}>
                <div className="overflow-hidden w-full">
                  <p className="text-[#F5F0E8] font-bold truncate">
                    {user.display_name || 'Tanpa Nama'}
                  </p>
                  <p className="text-xs text-[#A09890] truncate">{user.email}</p>
                  <p className="text-[10px] text-[#A09890] mt-1">ID: {user.id.substring(0, 8)}...</p>
                </div>
                <Button
                  onClick={() => approveUser(user.id)}
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
      </div>
    </div>
  );
}
