import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheck,
  UserCheck,
  XCircle,
  ArrowLeft,
  Trash2,
  Database,
  RefreshCw,
  Clock,
  UserX,
  Check,
  Loader2,
  Users,
} from 'lucide-react';
import { getSupabaseClientAsync } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';

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

type CleanupStats = Record<string, number>;

export default function AdminApprovalPage() {
  const [pendingUsers, setPendingUsers] = useState<UserData[]>([]);
  const [approvedUsers, setApprovedUsers] = useState<UserData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCleanupLoading, setIsCleanupLoading] = useState(false);
  const [cleanupStats, setCleanupStats] = useState<CleanupStats | null>(null);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const { session } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'Admin Approval - KeuanganKu';
    return () => {
      document.title = 'Keuanganku';
    };
  }, []);

  const loadUsers = async () => {
    setIsLoading(true);
    setError('');

    try {
      const client = await getSupabaseClientAsync();
      if (!client) throw new Error('Supabase client is not available.');

      const [pendingRes, approvedRes] = await Promise.all([
        client.rpc('get_pending_users'),
        client.rpc('get_approved_users'),
      ]);

      if (pendingRes.error) throw new Error(pendingRes.error.message || 'Failed to load pending users.');
      if (approvedRes.error && !approvedRes.error.message.includes('function get_approved_users() does not exist')) {
        throw new Error(approvedRes.error.message);
      }

      setPendingUsers(pendingRes.data || []);
      setApprovedUsers(approvedRes.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while loading data.');
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
      if (!client) throw new Error('Supabase client is not available.');

      const { error: updateErr } = await client.rpc('approve_user', {
        target_user_id: userId,
      });

      if (updateErr) {
        throw new Error(updateErr.message || 'Failed to approve user.');
      }

      setSuccessMsg('User approved successfully!');
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  const rejectOrDeleteUser = async (userId: string) => {
    if (!window.confirm('Are you sure you want to reject/remove this user account permanently?')) return;
    setError('');
    setSuccessMsg('');
    setIsLoading(true);
    try {
      const client = await getSupabaseClientAsync();
      if (!client) throw new Error('Supabase client is not available.');

      const { error: rejectErr } = await client.rpc('reject_user', {
        target_user_id: userId,
      });

      if (rejectErr) throw new Error(rejectErr.message || 'Failed to reject/remove user.');

      setSuccessMsg('User access revoked successfully!');
      setPendingUsers((prev) => prev.filter((u) => u.id !== userId));
      setApprovedUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while revoking access.');
    } finally {
      setIsLoading(false);
    }
  };

  const runSoftDeletedCleanup = async (dryRun: boolean) => {
    if (!dryRun) {
      const totalRows = cleanupStats
        ? Object.values(cleanupStats).reduce((sum, count) => sum + Number(count || 0), 0)
        : 0;
      const confirmed = window.confirm(
        `Permanently purge ${totalRows} soft-deleted rows? This action cannot be undone.`
      );
      if (!confirmed) return;
    }

    setError('');
    setSuccessMsg('');
    setIsCleanupLoading(true);
    try {
      const client = await getSupabaseClientAsync();
      if (!client) throw new Error('Supabase client is not available.');

      const { data, error: cleanupErr } = await client.rpc('cleanup_soft_deleted_rows', {
        dry_run: dryRun,
      });

      if (cleanupErr) {
        throw new Error(cleanupErr.message || 'Failed to execute cleanup.');
      }

      const stats = (data ?? {}) as CleanupStats;
      setCleanupStats(stats);
      const totalRows = Object.values(stats).reduce((sum, count) => sum + Number(count || 0), 0);
      setSuccessMsg(
        dryRun
          ? `Cleanup preview ready: ${totalRows} soft-deleted rows found.`
          : `Cleanup completed: ${totalRows} soft-deleted rows permanently purged.`
      );

      if (!dryRun) {
        const preview = await client.rpc('cleanup_soft_deleted_rows', { dry_run: true });
        if (!preview.error) setCleanupStats((preview.data ?? {}) as CleanupStats);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred during database cleanup.');
    } finally {
      setIsCleanupLoading(false);
    }
  };

  if (!session) return null;

  const cleanupTotal = cleanupStats
    ? Object.values(cleanupStats).reduce((sum, count) => sum + Number(count || 0), 0)
    : 0;

  return (
    <div className="min-h-dvh bg-[#0D0E12] text-white selection:bg-white/20 pb-16">
      {/* Sticky Header */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0D0E12]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-white/80 transition-all hover:bg-white/10 hover:text-white active:scale-95"
          >
            <ArrowLeft size={14} /> Back to Settings
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-5 space-y-5">
        {/* Admin Hero Card */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
          <div className="flex items-center gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#B8F55A]/30 bg-[#B8F55A]/10 text-[#B8F55A]">
              <ShieldCheck size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-bold text-white">Admin Dashboard</h1>
              <p className="text-xs text-white/50">
                Manage user approvals and database maintenance.
              </p>
            </div>
          </div>
        </div>

        {/* Notifications / Alerts */}
        {error && (
          <div className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-400 font-semibold animate-in fade-in">
            <XCircle size={16} className="shrink-0 text-red-400" />
            <span className="flex-1">{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="flex items-center gap-3 rounded-xl border border-green-500/30 bg-green-500/10 p-3.5 text-xs text-green-400 font-semibold animate-in fade-in">
            <UserCheck size={16} className="shrink-0 text-green-400" />
            <span className="flex-1">{successMsg}</span>
          </div>
        )}

        {/* SECTION 1: DATABASE MAINTENANCE */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.025] backdrop-blur-md p-4 space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400">
                <Database size={16} />
              </div>
              <div>
                <h2 className="text-xs font-bold text-white uppercase tracking-wider">Database Maintenance</h2>
                <p className="text-[11px] text-white/40">Purge records marked with <code className="text-white/70">deleted_at</code></p>
              </div>
            </div>
            {cleanupStats && (
              <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-white/[0.05] border border-white/10 text-white/60">
                {cleanupTotal} Soft Deleted
              </span>
            )}
          </div>

          {cleanupStats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              {Object.entries(cleanupStats).map(([tableName, count]) => (
                <div key={tableName} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
                  <p className="truncate text-[9px] font-bold uppercase tracking-wider text-white/40">{tableName}</p>
                  <p className="text-sm font-black text-white mt-0.5">{count}</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => runSoftDeletedCleanup(true)}
              disabled={isCleanupLoading}
              className="flex-1 py-2 px-3 rounded-xl bg-white/[0.05] hover:bg-white/10 border border-white/10 text-white font-semibold text-xs transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 active:scale-95"
            >
              {isCleanupLoading ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <RefreshCw size={13} className="text-white/60" />
              )}
              Preview Soft Deleted
            </button>
            <button
              type="button"
              onClick={() => runSoftDeletedCleanup(false)}
              disabled={isCleanupLoading || !cleanupStats || cleanupTotal === 0}
              className="flex-1 py-2 px-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 font-bold text-xs transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none active:scale-95"
            >
              {isCleanupLoading ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Trash2 size={13} />
              )}
              Purge Permanently
            </button>
          </div>
        </div>

        {/* SECTION 2: PENDING APPROVALS */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock size={15} className="text-[#B8F55A]" />
              <h2 className="text-xs font-bold text-white uppercase tracking-wider">
                Pending Approvals ({pendingUsers.length})
              </h2>
            </div>
            <button
              type="button"
              onClick={loadUsers}
              disabled={isLoading}
              className="text-xs font-semibold text-[#B8F55A] hover:underline flex items-center gap-1 active:scale-95 disabled:opacity-50"
            >
              <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>

          {isLoading && pendingUsers.length === 0 && approvedUsers.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center text-xs text-white/40 font-medium">
              <Loader2 size={20} className="animate-spin mx-auto mb-2 text-white/50" />
              Fetching user data...
            </div>
          ) : pendingUsers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.015] p-6 text-center text-xs text-white/40 font-medium">
              No pending registrations awaiting approval.
            </div>
          ) : (
            <div className="space-y-2.5">
              {pendingUsers.map((user) => (
                <div
                  key={user.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 hover:border-white/20 transition-all"
                >
                  <div className="min-w-0 flex-1 flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 font-bold text-sm">
                      {(user.display_name || user.email || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-bold text-white truncate">
                          {user.display_name || 'Unnamed Account'}
                        </p>
                        <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400">
                          Pending
                        </span>
                      </div>
                      <p className="text-[11px] text-white/50 truncate mt-0.5">{user.email}</p>
                      <p className="text-[9px] text-white/30 font-mono mt-0.5">ID: {user.id.substring(0, 8)}...</p>
                    </div>
                  </div>

                  <div className="flex gap-2 w-full sm:w-auto shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-white/5">
                    <button
                      type="button"
                      onClick={() => rejectOrDeleteUser(user.id)}
                      disabled={isLoading}
                      className="flex-1 sm:flex-none py-1.5 px-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 font-semibold text-xs transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 active:scale-95"
                    >
                      <UserX size={13} /> Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => approveUser(user.id)}
                      disabled={isLoading}
                      className="flex-1 sm:flex-none py-1.5 px-3 rounded-xl bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 text-green-400 font-semibold text-xs transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 active:scale-95"
                    >
                      <Check size={13} /> Approve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* SECTION 3: APPROVED USERS */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-2">
            <Users size={15} className="text-white/60" />
            <h2 className="text-xs font-bold text-white uppercase tracking-wider">
              Approved Members ({approvedUsers.length})
            </h2>
          </div>

          {approvedUsers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.015] p-6 text-center text-xs text-white/40 font-medium">
              No approved users found.
            </div>
          ) : (
            <div className="space-y-2.5">
              {approvedUsers.map((user) => (
                <div
                  key={user.id}
                  className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 hover:border-white/20 transition-all"
                >
                  <div className="min-w-0 flex-1 flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] border border-white/10 text-white/70 font-bold text-sm">
                      {(user.display_name || user.email || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-bold text-white truncate">
                          {user.display_name || 'Unnamed Account'}
                        </p>
                        {user.is_admin ? (
                          <span className="text-[9px] font-black px-2 py-0.5 rounded-md bg-[#B8F55A]/10 border border-[#B8F55A]/30 text-[#B8F55A] uppercase tracking-wider">
                            Admin
                          </span>
                        ) : (
                          <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/30 text-green-400">
                            Active
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-white/50 truncate mt-0.5">{user.email}</p>
                      <p className="text-[9px] text-white/30 font-mono mt-0.5">ID: {user.id.substring(0, 8)}...</p>
                    </div>
                  </div>

                  {!user.is_admin && (
                    <div className="w-full sm:w-auto shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-white/5">
                      <button
                        type="button"
                        onClick={() => rejectOrDeleteUser(user.id)}
                        disabled={isLoading}
                        className="w-full sm:w-auto py-1.5 px-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 font-semibold text-xs transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 active:scale-95"
                      >
                        <Trash2 size={13} /> Revoke Access
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
