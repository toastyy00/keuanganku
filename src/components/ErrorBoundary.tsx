import React from 'react';
import { AlertTriangle } from 'lucide-react';

// ============================================================
//  ERROR BOUNDARY — catches React render errors
// ============================================================

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error): void {
    // Apabila error berkaitan dengan chunk gagal diload (bisa karena versi baru sudah dideploy)
    // kita coba auto-refresh saja halamannya.
    const isModuleLoadError =
      error.message.includes('Failed to fetch dynamically imported module') ||
      error.message.includes('Importing a module script failed');

    if (isModuleLoadError) {
      const lastReload = sessionStorage.getItem('last_chunk_reload');
      const now = Date.now();
      
      // Auto-reload maksimum 1 kali setiap 10 detik untuk menghindari infinite reload loop
      if (!lastReload || now - parseInt(lastReload) > 10000) {
        sessionStorage.setItem('last_chunk_reload', now.toString());
        window.location.reload();
      }
    }
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="section-pad max-w-2xl mx-auto mt-8">
          <div className="neo-card p-6 bg-red-50">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle
                size={24}
                strokeWidth={2.5}
                className="text-red-500 shrink-0 mt-0.5"
              />
              <div>
                <h2 className="text-base font-black uppercase text-red-600">
                  Terjadi Kesalahan
                </h2>
                <p className="text-xs font-medium text-red-500 mt-1 font-mono">
                  {this.state.error?.message ?? 'Unknown error'}
                </p>
              </div>
            </div>
            <button
              onClick={this.handleReset}
              className="neo-btn neo-btn-primary text-sm"
            >
              Coba Lagi
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
