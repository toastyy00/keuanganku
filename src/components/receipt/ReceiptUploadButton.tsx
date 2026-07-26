import React, { useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';

// ============================================================
//  Receipt Upload Button
//
//  A button that opens the device camera/file picker to select
//  a receipt image. Shows a processing spinner while scanning.
// ============================================================

interface ReceiptUploadButtonProps {
  /** Whether a scan is currently in progress */
  isProcessing: boolean;
  /** Called when the user selects an image file */
  onFileSelected: (file: File) => void;
  /** Visual variant */
  variant?: 'inline' | 'compact';
}

export const ReceiptUploadButton: React.FC<ReceiptUploadButtonProps> = ({
  isProcessing,
  onFileSelected,
  variant = 'inline',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleClick = () => {
    if (isProcessing) return;
    inputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      onFileSelected(file);
    }
    // Reset input so same file can be re-selected
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isProcessing) setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (isProcessing) return;
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      onFileSelected(file);
    }
  };

  if (variant === 'compact') {
    return (
      <>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          type="button"
          onClick={handleClick}
          disabled={isProcessing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] border border-white/[0.08] hover:bg-white/[0.1] active:scale-95 transition-all text-white/60 hover:text-white/80 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Scan Struk"
        >
          {isProcessing ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Camera size={14} />
          )}
          <span className="text-[11px] font-bold">
            {isProcessing ? 'Memproses...' : 'Scan Struk'}
          </span>
        </button>
      </>
    );
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />
      <button
        type="button"
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        disabled={isProcessing}
        className={`
          w-full flex items-center justify-center gap-2.5 px-4 py-3
          rounded-xl border-2 border-dashed transition-all
          ${isDragging
            ? 'border-[#B8F55A]/50 bg-[#B8F55A]/[0.06]'
            : 'border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.05] hover:border-white/[0.15]'
          }
          ${isProcessing ? 'opacity-60 cursor-not-allowed' : 'active:scale-[0.98] cursor-pointer'}
        `}
      >
        {isProcessing ? (
          <>
            <div className="relative">
              <Loader2 size={20} className="animate-spin text-[#B8F55A]" />
            </div>
            <div className="text-left">
              <p className="text-xs font-bold text-white">Memproses struk...</p>
              <p className="text-[10px] text-white/40">AI sedang membaca data</p>
            </div>
          </>
        ) : (
          <>
            <div className="p-2 rounded-lg bg-[#B8F55A]/10">
              <Camera size={18} className="text-[#B8F55A]" />
            </div>
            <div className="text-left">
              <p className="text-xs font-bold text-white">Scan Struk / Nota</p>
              <p className="text-[10px] text-white/40">Foto atau pilih gambar struk</p>
            </div>
          </>
        )}
      </button>
    </>
  );
};
