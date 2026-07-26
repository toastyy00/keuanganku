import React, { useState, useEffect, useRef } from 'react';
import { FileText, CheckCircle2, ArrowRight } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { ReceiptInboxItem, ReceiptScanProgress } from '../../types';

interface ReceiptAiScanningOverlayProps {
  isScanning: boolean;
  scanProgress?: ReceiptScanProgress | null;
  imagePreviewUrl?: string | null;
  latestInboxItem?: ReceiptInboxItem | null;
  onReviewNow?: (item: ReceiptInboxItem) => void;
  onOpenInbox?: () => void;
  onCloseCache?: () => void;
}

const AI_STEPS = [
  { text: 'Analyzing' },
  { text: 'Understanding' },
  { text: 'Thinking' },
  { text: 'Processing' },
];

export const ReceiptAiScanningOverlay: React.FC<ReceiptAiScanningOverlayProps> = ({
  isScanning,
  scanProgress,
  imagePreviewUrl,
  latestInboxItem,
  onReviewNow,
  onOpenInbox,
  onCloseCache,
}) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [showCompletion, setShowCompletion] = useState(false);
  const [completedCount, setCompletedCount] = useState(1);
  const wasScanningRef = useRef(false);

  // AI Step progression text loop
  useEffect(() => {
    if (!isScanning) {
      setStepIndex(0);
      return;
    }

    const stepTimer = setInterval(() => {
      setStepIndex((prev) => (prev + 1) % AI_STEPS.length);
    }, 1400);

    return () => clearInterval(stepTimer);
  }, [isScanning]);

  // Detect transition from isScanning: true -> false
  useEffect(() => {
    if (isScanning) {
      wasScanningRef.current = true;
      setShowCompletion(false);
    } else if (wasScanningRef.current) {
      wasScanningRef.current = false;
      const count = scanProgress?.lastCount ?? scanProgress?.total ?? 1;
      setCompletedCount(count > 0 ? count : 1);
      setShowCompletion(true);
    }
  }, [isScanning, scanProgress]);

  if (!isScanning && !showCompletion) return null;

  const currentStep = AI_STEPS[stepIndex];
  const isMulti = Boolean(scanProgress && scanProgress.total > 1);

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex flex-col items-center justify-center p-5 bg-[#0E0E10]/95 backdrop-blur-2xl animate-in fade-in duration-300 select-none">
      {/* Background ambient lighting */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[380px] h-[380px] bg-white/[0.04] rounded-full blur-[120px] pointer-events-none" />

      {/* Main Glass Container - Clean & Modern */}
      <div className="relative w-full max-w-xs md:max-w-sm flex flex-col items-center justify-center bg-[#18181B]/95 border border-white/[0.10] rounded-3xl p-6 md:p-7 shadow-[0_32px_64px_rgba(0,0,0,0.85)] overflow-hidden text-center transition-all duration-300">
        
        {isScanning ? (
          /* ── SCANNING PHASE ── */
          <div className="flex flex-col items-center justify-center w-full py-4">
            {/* Taller Receipt Image / Scanner Target Container */}
            <div className="relative w-32 h-44 mb-6 rounded-2xl bg-[#1A1A1E] border border-white/10 overflow-hidden flex items-center justify-center shadow-2xl">
              {imagePreviewUrl ? (
                <img
                  src={imagePreviewUrl}
                  alt="Receipt Preview"
                  className="w-full h-full object-cover opacity-60 filter brightness-90"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-white/30 gap-1.5">
                  <FileText size={40} strokeWidth={1.5} />
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-white/30">
                    {isMulti && scanProgress ? `${scanProgress.current}/${scanProgress.total}` : 'Receipt'}
                  </span>
                </div>
              )}

              {/* Laser Scanning Line Animation */}
              <div className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-white to-transparent shadow-[0_0_16px_#ffffff] animate-[scan_2s_ease-in-out_infinite]" />
              
              {/* Subtle grid pattern overlay */}
              <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff0a_1px,transparent_1px),gradient(to_bottom,#ffffff0a_1px,transparent_1px)] bg-[size:12px_12px] pointer-events-none" />
            </div>

            {/* Unicode Braille Loader Spinner (Light Sync & Glowing Pulse) */}
            <div className="flex items-center justify-center my-4 h-10">
              <span className="braille-loader spinner-pulse" role="status" aria-label="Loading" />
            </div>

            {/* Step Status Message (Sleek Shimmering Text) */}
            <div className="h-8 flex flex-col items-center justify-center mb-2">
              <p
                key={`${stepIndex}-${scanProgress?.current ?? 0}`}
                className="animate-text-shimmer text-xs md:text-sm font-semibold tracking-wider animate-in fade-in slide-in-from-bottom-1 duration-300"
              >
                {currentStep.text}{isMulti && scanProgress ? ` (${scanProgress.current}/${scanProgress.total})` : '...'}
              </p>
            </div>
          </div>
        ) : (
          /* ── COMPLETION PHASE (Elegant, Modern, Clean UI) ── */
          <div className="flex flex-col items-center justify-center w-full py-2 animate-in zoom-in-95 fade-in duration-200">
            {/* Success Icon Badge */}
            <div className="w-12 h-12 rounded-2xl bg-white/[0.08] border border-white/15 text-white flex items-center justify-center mb-4 shadow-lg">
              <CheckCircle2 size={26} strokeWidth={2} />
            </div>

            {/* Clean Title */}
            <h3 className="text-base md:text-lg font-bold text-white tracking-tight">
              {completedCount > 1
                ? `${completedCount} Struk Berhasil Di-scan`
                : 'Struk Berhasil Di-scan'}
            </h3>

            {/* Scanned Receipt Card Deck (Stacked bottom cards effect - Reference Image) */}
            <div className="relative w-full my-4 pb-3">
              {/* Stacked Card 3 (Lowest layer peeking at bottom) */}
              {completedCount > 2 && (
                <div className="absolute top-2 inset-x-3.5 bottom-0 rounded-2xl bg-white/[0.04] border border-white/[0.06] opacity-50 shadow-md pointer-events-none" />
              )}
              {/* Stacked Card 2 (Middle layer peeking at bottom) */}
              {completedCount > 1 && (
                <div className="absolute top-1 inset-x-1.5 bottom-1.5 rounded-2xl bg-white/[0.08] border border-white/10 opacity-75 shadow-lg pointer-events-none" />
              )}

              {/* Foreground Top Card */}
              <div className="relative z-10 w-full bg-[#202024] border border-white/[0.12] rounded-2xl p-3 flex items-center gap-3 text-left shadow-2xl">
                <div className="w-9 h-9 rounded-xl bg-white/[0.08] border border-white/10 flex items-center justify-center text-white/80 shrink-0">
                  <FileText size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-white truncate">
                    {latestInboxItem?.store_name || (completedCount > 1 ? `${completedCount} Struk Baru` : 'Struk Baru')}
                  </p>
                  <p className="text-[11px] text-white/50 truncate mt-0.5">
                    {completedCount > 1
                      ? `+${completedCount - 1} struk lainnya siap ditinjau`
                      : 'Siap ditinjau & dicatat di inbox'}
                  </p>
                </div>
              </div>
            </div>

            {/* Clean Transparent Text Buttons Row */}
            <div className="flex items-center justify-between w-full pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowCompletion(false);
                  onCloseCache?.();
                }}
                className="text-white/40 hover:text-white text-xs font-medium transition-colors py-2 px-1 cursor-pointer active:opacity-70"
              >
                Nanti
              </button>

              {completedCount > 1 && onOpenInbox ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowCompletion(false);
                    onOpenInbox();
                  }}
                  className="text-white font-bold text-xs hover:text-white/80 transition-colors py-2 px-1 flex items-center gap-1.5 cursor-pointer active:opacity-70"
                >
                  <span>Buka Inbox</span>
                  <ArrowRight size={14} strokeWidth={2.5} />
                </button>
              ) : latestInboxItem && onReviewNow ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowCompletion(false);
                    onReviewNow(latestInboxItem);
                  }}
                  className="text-white font-bold text-xs hover:text-white/80 transition-colors py-2 px-1 flex items-center gap-1.5 cursor-pointer active:opacity-70"
                >
                  <span>Tinjau Struk</span>
                  <ArrowRight size={14} strokeWidth={2.5} />
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default ReceiptAiScanningOverlay;
