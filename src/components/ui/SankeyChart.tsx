import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Expense } from '../../types';
import { useUIStore } from '../../store/useAppStore';
import { useExpenseStore } from '../../store/useExpenseStore';
import { formatCurrency } from '../../lib/utils';

interface SankeyChartProps {
  expenses: Expense[];
  /** Override chart height in px. Default: 220 */
  height?: number;
  /** Custom double-click handler for category labels. Defaults to navigate('/history'). */
  onCatDoubleClick?: (slug: string) => void;
}

// Generic height allocator with strict min/max clamping, iteratively resolves conflicts
function allocateHeights<T>(
  items: T[],
  getVal: (item: T) => number,
  availableHeight: number,
  minH: number,
  maxH: number
): number[] {
  if (items.length === 0) return [];

  const effectiveMin = Math.min(minH, availableHeight / items.length);
  const effectiveMax = Math.max(maxH, effectiveMin);

  let remaining = availableHeight;
  let pending = items.map((item, i) => ({ val: Math.max(getVal(item), 0), index: i }));
  const result = new Array(items.length).fill(0);
  let changed = true;

  while (changed && pending.length > 0) {
    changed = false;
    const total = pending.reduce((s, it) => s + it.val, 0);

    if (total === 0) {
      const even = remaining / pending.length;
      pending.forEach(it => { result[it.index] = Math.min(Math.max(even, effectiveMin), effectiveMax); });
      pending = [];
      break;
    }

    for (let i = 0; i < pending.length; i++) {
      const it = pending[i];
      const expected = (it.val / total) * remaining;
      if (expected < effectiveMin) {
        result[it.index] = effectiveMin;
        remaining -= effectiveMin;
        pending.splice(i, 1);
        changed = true;
        break;
      } else if (expected > effectiveMax) {
        result[it.index] = effectiveMax;
        remaining -= effectiveMax;
        pending.splice(i, 1);
        changed = true;
        break;
      }
    }
  }

  if (pending.length > 0) {
    const total = pending.reduce((s, it) => s + it.val, 0);
    pending.forEach(it => {
      result[it.index] = total > 0
        ? (it.val / total) * remaining
        : remaining / pending.length;
    });
  }

  return result;
}

export const SankeyChart: React.FC<SankeyChartProps> = ({ expenses, height, onCatDoubleClick }) => {
  const navigate = useNavigate();
  const { sankeyHighlightedCat, setSankeyHighlightedCat } = useUIStore();
  const { currency } = useExpenseStore();
  const [clickedLeftId, setClickedLeftId] = React.useState<string | null>(null);
  const [hoveredCategorySlug, setHoveredCategorySlug] = React.useState<string | null>(null);

  // ── Layout constants ──────────────────────────────────────────────────────
  const CH = height ?? 220;  // Chart height (px)
  const CW = 1000;   // SVG viewBox virtual width
  const ENDCAP_W = 14;
  const GAP = 4;     // Gap between flow/category segments
  // Left flows: power scale to compress outlier transactions
  const FLOW_POWER = 0.6;
  // Shift slightly inward (12 units) to prevent SVG glow clipping at strict edges
  const leftX = 12;
  const rightX = CW - 12;

  // ── Data calculation ──────────────────────────────────────────────────────
  const { flows, rightNodes, defaultTop1 } = useMemo(() => {
    if (expenses.length === 0) return { flows: [], rightNodes: [], defaultTop1: null };

    // 1. Aggregate per category with two separate scales
    const catStats = new Map<string, {
      rawAmount: number;
      flowScaled: number;
      count: number;
    }>();
    let totalFlowScaled = 0;

    expenses.forEach(e => {
      const fs = Math.pow(Math.max(e.amount, 0), FLOW_POWER);
      const stat = catStats.get(e.category) ?? { rawAmount: 0, flowScaled: 0, count: 0 };
      stat.rawAmount += e.amount;
      stat.flowScaled += fs;
      stat.count += 1;
      totalFlowScaled += fs;
      catStats.set(e.category, stat);
    });

    if (totalFlowScaled === 0) return { flows: [], rightNodes: [], defaultTop1: null };

    // 2. Sort categories largest → smallest (raw amount guarantees rank order)
    const sortedCats = Array.from(catStats.entries())
      .map(([slug, s]) => ({ slug, ...s }))
      .sort((a, b) => b.rawAmount - a.rawAmount || b.count - a.count);

    const top1Slug = sortedCats[0]?.slug ?? null;

    // 3. Sort transactions newest → oldest
    const sortedTxns = [...expenses].sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    // 4. Available heights after gaps
    const leftGaps = Math.max(0, sortedTxns.length - 1);
    const rightGaps = Math.max(0, sortedCats.length - 1);
    const availL = Math.max(1, CH - leftGaps * GAP);
    const availR = Math.max(1, CH - rightGaps * GAP);

    // 5. Right (category) heights — strict allocation to prevent overflow
    //    power scale (^0.65) compresses outliers so small categories get visible bars.
    const maxRawCat = sortedCats[0]?.rawAmount ?? 1;
    const rightHeights = allocateHeights(
      sortedCats,
      c => Math.pow(c.rawAmount / maxRawCat, 0.65),
      availR,
      24, // CAT_MIN (min height per category)
      availR * 0.7 // CAT_MAX
    );
    const rightHMap = new Map<string, number>();
    sortedCats.forEach((c, i) => rightHMap.set(c.slug, rightHeights[i]));

    // 6. Build right nodes — vertically centred
    const rNodes: { slug: string; y: number; h: number }[] = [];
    const catCursorY = new Map<string, number>();
    const totalRightH = rightHeights.reduce((s, h) => s + h, 0) + rightGaps * GAP;
    let curRY = Math.max(0, (CH - totalRightH) / 2);

    sortedCats.forEach(({ slug }) => {
      const h = rightHMap.get(slug) ?? 0;
      rNodes.push({ slug, y: curRY, h });
      catCursorY.set(slug, curRY);
      curRY += h + GAP;
    });

    // 7. Left (transaction) heights — proportional to transaction amount
    // We use a high max bound so if there is plenty of space, large transactions get thicker flows.
    const leftHeights = allocateHeights(
      sortedTxns, e => Math.pow(Math.max(e.amount, 0), FLOW_POWER), availL, 4, availL * 0.5
    );
    const totalLeftH = leftHeights.reduce((s, h) => s + h, 0) + leftGaps * GAP;
    let curLY = Math.max(0, (CH - totalLeftH) / 2);

    // 8. Build flows
    const f: {
      id: string;
      leftY: number; leftH: number;
      rightY: number; rightH: number;
      categorySlug: string;
      name: string;
      amount: number;
    }[] = [];

    sortedTxns.forEach((exp, i) => {
      if (exp.amount <= 0) return;
      const leftH = leftHeights[i] ?? 0;
      const fs = Math.pow(exp.amount, FLOW_POWER);
      const catFlowTotal = catStats.get(exp.category)?.flowScaled ?? 1;
      const catH = rightHMap.get(exp.category) ?? 0;
      const rightH = (fs / catFlowTotal) * catH;

      const targetY = catCursorY.get(exp.category) ?? 0;
      f.push({ id: exp.id, leftY: curLY, leftH, rightY: targetY, rightH, categorySlug: exp.category, name: exp.name, amount: exp.amount });

      curLY += leftH + GAP;
      catCursorY.set(exp.category, targetY + rightH);
    });

    return { flows: f, rightNodes: rNodes, defaultTop1: top1Slug };
  }, [expenses, CH]);

  const highlightedCat = sankeyHighlightedCat ?? defaultTop1;
  const isHoverMode = hoveredCategorySlug !== null;

  const handleCatClick = (slug: string) => {
    setSankeyHighlightedCat(slug);
    setClickedLeftId(null);
    setHoveredCategorySlug(null);
  };

  const handleCatHover = (slug: string) => {
    setHoveredCategorySlug(slug === highlightedCat ? null : slug);
  };

  const handleCatDoubleClick = (slug: string) => {
    setSankeyHighlightedCat(slug); // persist the highlight
    setHoveredCategorySlug(null);
    if (onCatDoubleClick) {
      onCatDoubleClick(slug);
    } else {
      navigate('/history', { state: { categorySlug: slug, fromSankey: true } });
    }
  };

  // ── Label layout: anti-overlap stack ─────────────────────────────────────
  const LABEL_GAP_PX = 1;
  const MIN_LABEL_H = 13;
  const MAX_LABEL_H = 26;

  const labels = useMemo(() => {
    const maxCatH = Math.max(1, ...rightNodes.map(n => n.h));
    const acc = rightNodes.reduce<{
      items: Array<(typeof rightNodes)[number] & { labelTop: number; labelH: number; fontSize: number }>;
      lastBottom: number;
    }>((state, n) => {
      // Scale label size based on node height relative to max node height
      const scale = Math.pow(n.h / maxCatH, 0.5);
      const curLabelH = Math.round(MIN_LABEL_H + scale * (MAX_LABEL_H - MIN_LABEL_H));
      const fontSize = Math.round(8 + scale * (14 - 8)); // scales from 8px to 14px

      const center = n.y + n.h / 2;
      let top = center - curLabelH / 2;
      if (top < state.lastBottom + LABEL_GAP_PX) top = state.lastBottom + LABEL_GAP_PX;

      state.items.push({ ...n, labelTop: top, labelH: curLabelH, fontSize });
      return {
        items: state.items,
        lastBottom: top + curLabelH,
      };
    }, { items: [], lastBottom: -Infinity });

    return acc.items;
  }, [rightNodes]);

  const LEFT_LABEL_H = 15;

  const visibleLeftLabels = useMemo(() => {
    const visibleKinds = new Map<string, 'active' | 'hover'>();
    if (hoveredCategorySlug) {
      visibleKinds.set(hoveredCategorySlug, 'hover');
    } else if (highlightedCat) {
      visibleKinds.set(highlightedCat, 'active');
    }

    if (visibleKinds.size === 0) return [];

    const visibleFlows = flows
      .filter(f => visibleKinds.has(f.categorySlug))
      .sort((a, b) => a.leftY - b.leftY);

    const acc = visibleFlows.reduce<{
      items: Array<(typeof visibleFlows)[number] & { labelTop: number; labelKind: 'active' | 'hover' }>;
      lastBottom: number;
    }>((state, f) => {
      const center = f.leftY + f.leftH / 2;
      let top = center - LEFT_LABEL_H / 2;
      if (top < state.lastBottom + LABEL_GAP_PX) top = state.lastBottom + LABEL_GAP_PX;

      state.items.push({
        ...f,
        labelTop: top,
        labelKind: visibleKinds.get(f.categorySlug) ?? 'hover',
      });
      return {
        items: state.items,
        lastBottom: top + LEFT_LABEL_H,
      };
    }, { items: [], lastBottom: -Infinity });

    return acc.items;
  }, [flows, highlightedCat, hoveredCategorySlug]);

  if (flows.length === 0) {
    return (
      <div
        className="w-full flex flex-col items-center justify-center border-4 border-dashed border-[#3A3A3A] mb-6 select-none"
        style={{ height: `${CH}px` }}
      >
        <span className="text-3xl mb-2 opacity-30 grayscale">🍃</span>
        <p className="text-[10px] font-black uppercase tracking-widest text-[#555]">
          Tidak ada pengeluaran
        </p>
      </div>
    );
  }

  // ── Derived SVG coords ────────────────────────────────────────────────────
  const flowStartX = leftX + ENDCAP_W;
  const flowEndX = rightX - ENDCAP_W - 2;
  const rightBarX = rightX - ENDCAP_W;

  return (
    <div
      className="w-full relative select-none mb-6"
      style={{ height: `${CH}px` }}
      onMouseLeave={() => setHoveredCategorySlug(null)}
    >
      <svg
        viewBox={`0 0 ${CW} ${CH}`}
        preserveAspectRatio="none"
        className="absolute inset-0 w-full"
        style={{ height: `${CH}px`, top: 0, overflow: 'visible' }}
      >
        <defs>
          {/* Active: left=muted teal, right=dark lime green */}
          <linearGradient id="sankey-hl" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#2F8FA3" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#5a8a1e" stopOpacity="0.85" />
          </linearGradient>
          {/* Inactive: dark earthy grey fading out */}
          <linearGradient id="sankey-grey" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#2F8FA3" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#777" stopOpacity="0.25" />
          </linearGradient>
          <linearGradient id="sankey-hover" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#2F8FA3" stopOpacity="0.38" />
            <stop offset="100%" stopColor="#5a8a1e" stopOpacity="0.28" />
          </linearGradient>
          {/* Left endcap glow filter for active */}
          <filter id="endcap-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {/* Left endcap inactive glow */}
          <filter id="endcap-glow-dim" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* ── Flows ── */}
        {flows.map((f, i) => {
          const isActive = !isHoverMode && f.categorySlug === highlightedCat;
          const isInactiveHovered = hoveredCategorySlug === f.categorySlug;
          const cx1 = flowStartX + (flowEndX - flowStartX) * 0.55;
          const cx2 = flowEndX - (flowEndX - flowStartX) * 0.55;

          const d = [
            `M ${flowStartX.toFixed(1)} ${f.leftY.toFixed(1)}`,
            `C ${cx1.toFixed(1)} ${f.leftY.toFixed(1)}, ${cx2.toFixed(1)} ${f.rightY.toFixed(1)}, ${flowEndX.toFixed(1)} ${f.rightY.toFixed(1)}`,
            `L ${flowEndX.toFixed(1)} ${(f.rightY + f.rightH).toFixed(1)}`,
            `C ${cx2.toFixed(1)} ${(f.rightY + f.rightH).toFixed(1)}, ${cx1.toFixed(1)} ${(f.leftY + f.leftH).toFixed(1)}, ${flowStartX.toFixed(1)} ${(f.leftY + f.leftH).toFixed(1)}`,
            'Z',
          ].join(' ');

          return (
            <g
              key={`f-${f.id}-${i}`}
              className="cursor-pointer"
              onClick={() => handleCatClick(f.categorySlug)}
              onMouseEnter={() => handleCatHover(f.categorySlug)}
            >
              {/* Left endcap — dark charcoal with glow so it stands out from background */}
              <rect
                x={leftX} y={f.leftY}
                width={ENDCAP_W} height={Math.max(f.leftH, 2)}
                fill={isActive || isInactiveHovered ? '#1F6473' : '#24404A'}
                opacity={isActive ? 1 : isInactiveHovered ? 0.58 : 0.3}
                rx={3}
                filter={isActive ? 'url(#endcap-glow)' : isInactiveHovered ? 'url(#endcap-glow-dim)' : ''}
                className="transition-all duration-200"
              />
              {/* Bezier flow band */}
              <path
                d={d}
                fill={isActive ? 'url(#sankey-hl)' : isInactiveHovered ? 'url(#sankey-hover)' : 'url(#sankey-grey)'}
                opacity={isActive ? 1 : isInactiveHovered ? 0.96 : 0.75}
                className="transition-all duration-200"
              />
            </g>
          );
        })}

        {/* ── Right endcaps (one per category) ── */}
        {rightNodes.map((n, i) => {
          const isActive = !isHoverMode && n.slug === highlightedCat;
          const isHoveredTarget = hoveredCategorySlug === n.slug;
          return (
            <rect
              key={`rc-${n.slug}-${i}`}
              x={rightBarX} y={n.y}
              width={ENDCAP_W} height={Math.max(n.h, 2)}
              fill={isActive ? '#9DBB62' : isHoveredTarget ? '#6F8E4A' : '#555'}
              opacity={isActive ? 0.9 : isHoveredTarget ? 0.58 : 1}
              rx={3}
              className="transition-[fill,opacity] duration-200"
            />
          );
        })}
      </svg>

      {/* ── HTML label overlay ── */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Right side labels (Categories) */}
        {labels.map(n => {
          const isActive = !isHoverMode && n.slug === highlightedCat;
          const isHoveredLabel = hoveredCategorySlug === n.slug;
          return (
            <div
              key={n.slug}
              className={[
                'absolute right-0 flex items-center px-1.5 rounded',
                'font-black tracking-wider uppercase',
                'pointer-events-auto cursor-pointer select-none',
                'transition-all duration-200 whitespace-nowrap border',
                isActive
                  ? 'bg-[#B8F55A] text-[#111] border-transparent'
                  : isHoveredLabel
                    ? 'bg-[#293A25] text-[#C6D6AF] border-[#6F8E4A]/30 shadow-sm'
                  : 'bg-black/25 text-[#888] border-transparent hover:text-[#ccc] hover:bg-black/40',
              ].join(' ')}
              style={{ top: `${n.labelTop}px`, height: `${n.labelH}px`, fontSize: `${n.fontSize}px` }}
              onClick={() => handleCatClick(n.slug)}
              onDoubleClick={() => handleCatDoubleClick(n.slug)}
              onMouseEnter={() => handleCatHover(n.slug)}
            >
              {n.slug.toUpperCase()}
            </div>
          );
        })}

        {visibleLeftLabels.map(fl => {
          const isHoverLabel = fl.labelKind === 'hover';
          const isClicked = clickedLeftId === fl.id;
          return (
          <div
            key={fl.id}
            className={[
              'absolute flex items-center px-1.5 rounded',
              'text-[9px] font-black tracking-wider uppercase',
              'pointer-events-auto cursor-pointer whitespace-nowrap overflow-hidden text-ellipsis',
              'transition-all duration-200',
              isHoverLabel
                ? isClicked
                  ? 'bg-[#1D302B] text-[#D5E2D0] border border-[#8AA861]/45 z-10 shadow-sm'
                  : 'bg-[#243932]/90 text-[#B8CDBD] border border-[#6F8E4A]/30 shadow-sm'
                : isClicked
                  ? 'bg-[#143B45] text-[#9EE7F1] z-10 shadow-md'
                  : 'bg-[#1F6473] text-[#9EE7F1] shadow-md'
            ].join(' ')}
            style={{ left: 0, top: `${fl.labelTop}px`, height: `${LEFT_LABEL_H}px`, maxWidth: isClicked ? '80%' : '40%' }}
            onClick={(e) => {
              e.stopPropagation();
              setClickedLeftId(prev => prev === fl.id ? null : fl.id);
            }}
            onMouseEnter={() => handleCatHover(fl.categorySlug)}
          >
            {fl.name}
            {isClicked && (
              <span className={`ml-1.5 font-black opacity-95 ${isHoverLabel ? 'text-[#AFC973]' : 'text-[#B8F55A]'}`}>
                {formatCurrency(fl.amount, currency)}
              </span>
            )}
          </div>
          );
        })}
      </div>
      
      {/* Background click handler to clear left label selection */}
      <div 
        className="absolute inset-0 z-[-1]" 
        onClick={() => setClickedLeftId(null)} 
      />
    </div>
  );
};
