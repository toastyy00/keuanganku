import { useState, useEffect } from 'react';
import { Button } from '../components/ui/Button';
import { ShieldCheck, UserCheck, XCircle, ArrowLeft, Trash2 } from 'lucide-react';
import { getSupabaseClientAsync } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';
import { useNavigate } from 'react-router-dom';

// ============================================================
//  ADMIN APPROVAL PAGE
//  Secured via Supabase RPC and is_admin flag in profiles table
// ============================================================

interface UserData {
  id: string;
  email: string;
  display_name: string;
  is_admin?: boolean;
}

export default function AdminApprovalPage() {
  const [pendingUsers, setPendingUsers] = useState<UserData[]>([]);
  const [approvedUsers, setApprovedUsers] = useState<UserData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  
  const { session } = useAuthStore();
  const navigate = useNavigate();

  const loadUsers = async () => {
    setIsLoading(true);
    setError('');
    
    try {
      const client = await getSupabaseClientAsync();
      if (!client) throw new Error('Supabase client tidak tersedia.');

      const [pendingRes, approvedRes] = await Promise.all([
        client.rpc('get_pending_users'),
        client.rpc('get_approved_users')
      ]);
      
      // If the second RPC doesn't exist yet, catch it gracefully
      if (pendingRes.error) throw new Error(pendingRes.error.message || 'Gagal memuat user pending.');
      if (approvedRes.error && !approvedRes.error.message.includes('function get_approved_users() does not exist')) {
        throw new Error(approvedRes.error.message);
      }

      setPendingUsers(pendingRes.data || []);
      setApprovedUsers(approvedRes.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan saat memuat data. (Sudah update SQL?)');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!session) {
      navigate('/login');
      return;
    }
    loadUsers();
  }, [session, navigate]);

  const approveUser = async (userId: string) => {
    setError('');
    setSuccessMsg('');
    setIsLoading(true);
    try {
      const client = await getSupabaseClientAsync();
      if (!client) throw new Error('Supabase client tidak tersedia.');

      const { error: updateErr } = await client.rpc('approve_user', {
        target_user_id: userId
      });

      if (updateErr) {
        throw new Error(updateErr.message || 'Gagal menyetujui user.');
      }

      setSuccessMsg('User berhasil disetujui!');
      loadUsers(); // Reload to move from pending to approved
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan tidak dikenal.');
    } finally {
      setIsLoading(false);
    }
  };

  const rejectOrDeleteUser = async (userId: string) => {
    if (!window.confirm('Yakin ingin menolak/menghapus akun ini secara permanen? Data mereka akan hilang!')) return;
    setError('');
    setSuccessMsg('');
    setIsLoading(true);
    try {
      const client = await getSupabaseClientAsync();
      if (!client) throw new Error('Supabase client tidak tersedia.');

      const { error: rejectErr } = await client.rpc('reject_user', {
        target_user_id: userId
      });

      if (rejectErr) throw new Error(rejectErr.message || 'Gagal menolak/menghapus user.');

      setSuccessMsg('Akses user berhasil dihapus!');
      setPendingUsers((prev) => prev.filter((u) => u.id !== userId));
      setApprovedUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan saat menghapus. Pastikan SQL reject_user sudah di-run.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!session) return null;

  return (
    <div className="min-h-dvh flex flex-col items-center p-4 py-8" style={{ backgroundColor: '#1A1A1A' }}>
      <div className="w-full max-w-lg space-y-6">
        
        {/* Back Button */}
        <button
          onClick={() => navigate('/settings')}
          className="flex items-center gap-2 px-4 py-2 border-2 border-[#555555] text-xs font-black uppercase hover:bg-[#3A3A3A] transition-colors bg-[#242424]"
          style={{ color: '#F5F0E8' }}
        >
          <ArrowLeft size={16} strokeWidth={2.5} />
          Kembali ke Settings
        </button>

        {/* Header */}
        <div className="border-3 border-[#F5F0E8] p-4 text-center" style={{ backgroundColor: '#B8F55A', boxShadow: '4px 4px 0px 0px #F5F0E8' }}>
          <div className="flex justify-center mb-2">
            <ShieldCheck size={32} style={{ color: '#1A1A1A' }} />
          </div>
          <h1 className="text-xl font-black uppercase tracking-tight" style={{ color: '#1A1A1A' }}>
            Admin Dashboard
          </h1>
          <p className="text-xs font-bold mt-1" style={{ color: '#1A1A1A', opacity: 0.8 }}>
            Manajemen Akses & Persetujuan
          </p>
        </div>

        {/* Error / Success Messages */}
        {error && (
          <div className="border-2 border-red-500 bg-red-500/10 p-3 text-red-500 text-sm font-bold flex items-center gap-2">
            <XCircle size={16} className="shrink-0" /> <span className="flex-1">{error}</span>
          </div>
        )}
        {successMsg && (
          <div className="border-2 border-green-500 bg-green-500/10 p-3 text-green-500 text-sm font-bold flex items-center gap-2">
            <UserCheck size={16} className="shrink-0" /> <span className="flex-1">{successMsg}</span>
          </div>
        )}

        {/* PENDING USERS SECTION */}
        <div className="flex justify-between items-center mb-2 mt-8">
          <h2 className="text-[#F5F0E8] font-bold uppercase tracking-widest text-sm">Menunggu Persetujuan ({pendingUsers.length})</h2>
          <button onClick={loadUsers} className="text-xs text-[#B8F55A] underline font-bold">Muat Ulang</button>
        </div>

        <div className="space-y-4">
          {isLoading && pendingUsers.length === 0 && approvedUsers.length === 0 ? (
            <div className="border-3 border-[#555555] p-6 text-center text-[#A09890] font-medium" style={{ backgroundColor: '#242424' }}>
              Memuat data...
            </div>
          ) : pendingUsers.length === 0 ? (
            <div className="border-3 border-dashed border-[#555555] p-6 text-center text-[#A09890] font-medium text-sm" style={{ backgroundColor: '#242424' }}>
              Tidak ada user yang menunggu persetujuan.
            </div>
          ) : (
            pendingUsers.map((user) => (
              <div key={user.id} className="border-3 border-[#555555] p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4" style={{ backgroundColor: '#242424' }}>
                <div className="overflow-hidden w-full">
                  <p className="text-[#F5F0E8] font-bold truncate">
                    {user.display_name || 'Tanpa Nama'}
                  </p>
                  <p className="text-xs text-[#A09890] truncate">{user.email}</p>
                  <p className="text-[10px] text-[#A09890] mt-1">ID: {user.id.substring(0, 8)}...</p>
                </div>
                <div className="flex gap-2 w-full sm:w-auto shrink-0">
                  <Button
                    onClick={() => rejectOrDeleteUser(user.id)}
                    loading={isLoading}
                    variant="destructive"
                    className="flex-1 sm:flex-none"
                  >
                    Tolak
                  </Button>
                  <Button
                    onClick={() => approveUser(user.id)}
                    loading={isLoading}
                    className="flex-1 sm:flex-none"
                    style={{ backgroundColor: '#4CAF50', borderColor: '#4CAF50', color: 'white' }}
                  >
                    Setujui
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* APPROVED USERS SECTION */}
        <div className="flex justify-between items-center mb-2 mt-8">
          <h2 className="text-[#F5F0E8] font-bold uppercase tracking-widest text-sm">Pengguna Terdaftar ({approvedUsers.length})</h2>
        </div>

        <div className="space-y-4 mb-8">
          {approvedUsers.length === 0 ? (
            <div className="border-3 border-dashed border-[#555555] p-6 text-center text-[#A09890] font-medium text-sm" style={{ backgroundColor: '#242424' }}>
              Belum ada pengguna aktif (atau RPC SQL belum ditambahkan).
            </div>
          ) : (
            approvedUsers.map((user) => (
              <div key={user.id} className="border-3 border-[#555555] p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4" style={{ backgroundColor: '#242424' }}>
                <div className="overflow-hidden w-full">
                  <p className="text-[#F5F0E8] font-bold truncate flex items-center gap-2">
                    {user.display_name || 'Tanpa Nama'}
                    {user.is_admin && (
                      <span className="bg-[#B8F55A] text-[#1A1A1A] text-[9px] px-1.5 py-0.5 uppercase tracking-widest rounded-sm font-black">Admin</span>
                    )}
                  </p>
                  <p className="text-xs text-[#A09890] truncate">{user.email}</p>
                  <p className="text-[10px] text-[#A09890] mt-1">ID: {user.id.substring(0, 8)}...</p>
                </div>
                <div className="w-full sm:w-auto shrink-0">
                  {!user.is_admin && (
                    <Button
                      onClick={() => rejectOrDeleteUser(user.id)}
                      loading={isLoading}
                      variant="destructive"
                      className="w-full sm:w-auto"
                      leftIcon={<Trash2 size={14} />}
                    >
                      Hapus Akses
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

      </div>
    </div>
  );
}

