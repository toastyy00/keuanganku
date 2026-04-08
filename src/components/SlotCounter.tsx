import React, { useEffect, useState, useRef } from 'react';

// ============================================================
//  SLOT COUNTER — animasi mesin slot per karakter
//  Hanya digit (0-9) yang di-animasikan.
//  Karakter non-digit dirender sebagai text node murni tanpa
//  wrapper span, sehingga letter-spacing & kerning tetap identik
//  dengan teks asli.
// ============================================================

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

interface SlotDigitProps {
  char: string;
  duration: number;
  delay: number;
  play: boolean;
  skipAnim: boolean;
}

/**
 * Satu "drum" slot machine untuk satu digit.
 * Menggunakan `display: inline-block` + `overflow: hidden` + CSS translateY.
 * Tidak pakai `willChange` agar teks tidak blur karena composite layer.
 */
const SlotDigit: React.FC<SlotDigitProps> = ({ char, duration, delay, play, skipAnim }) => {
  const [started, setStarted] = useState(skipAnim);

  const targetIndex = DIGITS.indexOf(char);

  useEffect(() => {
    if (skipAnim) return;
    if (play) {
      const t = setTimeout(() => setStarted(true), delay);
      return () => clearTimeout(t);
    }
  }, [play, delay, skipAnim]);

  if (targetIndex === -1) return <>{char}</>;

  // 2 putaran penuh sebelum landing di angka target
  const extraSpins = 2;
  const totalItems = DIGITS.length * extraSpins + targetIndex + 1;
  const finalY = -(totalItems - 1); // dalam satuan em

  return (
    // Outer: clip window — lebar natural dari font tabular-nums, tinggi 1em
    <span
      style={{
        display: 'inline-block',
        overflow: 'hidden',
        height: '1em',
        verticalAlign: 'top', // cocok untuk leading-none (line-height: 1)
      }}
    >
      {/* Inner strip yang di-scroll secara vertikal */}
      <span
        style={{
          display: 'block',
          transform: started ? `translateY(${finalY}em)` : 'translateY(0em)',
          transition: started
            ? `transform ${duration}ms cubic-bezier(0.23, 1, 0.32, 1)`
            : 'none',
          // Sengaja tidak pakai willChange — mencegah blur akibat composite layer
        }}
      >
        {/* extraSpins putaran penuh (digit 0–9 diulang) */}
        {Array.from({ length: extraSpins }, (_, si) =>
          DIGITS.map((d) => (
            <span
              key={`s${si}${d}`}
              style={{ display: 'block', height: '1em', lineHeight: '1' }}
            >
              {d}
            </span>
          ))
        )}
        {/* Barisan akhir: hanya sampai digit target */}
        {DIGITS.slice(0, targetIndex + 1).map((d) => (
          <span
            key={`f${d}`}
            style={{ display: 'block', height: '1em', lineHeight: '1' }}
          >
            {d}
          </span>
        ))}
      </span>
    </span>
  );
};

// ============================================================

interface SlotCounterProps {
  /** String format mata uang, misal "Rp 1.234.567" atau "$12.34" */
  value: string;
  /** Durasi tiap digit dalam ms. Default: 1200 */
  duration?: number;
  /** Delay awal sebelum animasi mulai dalam ms. Default: 150 */
  initialDelay?: number;
  /** ClassName diteruskan ke wrapper span utama */
  className?: string;
  /** Style diteruskan ke wrapper span utama */
  style?: React.CSSProperties;
  /** Animasi hanya berjalan jika nilainya baru (dalam satu sesi). Default: true */
  animateOnlyOnce?: boolean;
  /** Identifier unik memori animasi. Wajib jika ada banyak SlotCounter di satu halaman. Default: 'default' */
  animateId?: string;
}

// Untuk melacak nilai terakhir yang sudah dianimasikan berdasarkan ID dalam satu sesi browser
const sessionMemories = new Map<string, string>();

/**
 * SlotCounter: merender string `value` dengan animasi slot machine
 * hanya pada karakter digit. Non-digit dirender sebagai text node
 * murni (React.Fragment) agar letter-spacing & kerning identik
 * dengan teks asli — tidak ada perbedaan lebar atau sharpness.
 */
export const SlotCounter: React.FC<SlotCounterProps> = ({
  value,
  duration = 1200,
  initialDelay = 150,
  className,
  style,
  animateOnlyOnce = true,
  animateId = 'default',
}) => {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.5 } // Setengah terlihat baru diputar, menghindari ke-trigger saat animasi peek
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [willAnimate] = useState(() => {
    if (!animateOnlyOnce) return true;
    if (sessionMemories.get(animateId) === value) return false;
    sessionMemories.set(animateId, value);
    return true;
  });

  const chars = value.split('');

  // Hitung urutan digit untuk stagger delay
  let digitCount = 0;
  const digitIndices: number[] = [];
  chars.forEach((c) => {
    if (DIGITS.includes(c)) {
      digitIndices.push(digitCount++);
    } else {
      digitIndices.push(-1);
    }
  });
  const totalDigits = digitCount;

  return (
    // Wrapper: plain <span> tanpa display flex/inline-flex
    // agar identik dengan rendering teks asli dari parent container
    <span className={className} style={style} ref={containerRef}>
      {chars.map((char, i) => {
        const dIdx = digitIndices[i];

        if (dIdx === -1) {
          // Non-digit → text node murni tanpa <span> wrapper
          return (
            <React.Fragment key={i}>
              {char === ' ' ? '\u00A0' : char}
            </React.Fragment>
          );
        }

        // Digit → animasi slot dengan stagger kiri→kanan
        const staggerFraction = totalDigits > 1 ? dIdx / (totalDigits - 1) : 0;
        const charDuration = willAnimate ? duration + staggerFraction * 200 : 0;
        const charDelay = willAnimate ? initialDelay + staggerFraction * 300 : 0;

        return (
          <SlotDigit
            key={i}
            char={char}
            duration={charDuration}
            delay={charDelay}
            play={isVisible}
            skipAnim={!willAnimate}
          />
        );
      })}
    </span>
  );
};

export default SlotCounter;
