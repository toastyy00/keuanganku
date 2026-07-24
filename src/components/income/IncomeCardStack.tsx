import React, { useState } from 'react';
import { IncomeSummaryCard } from './IncomeSummaryCard';
import { IncomeChartCard } from './IncomeChartCard';
import type { IncomeEntry } from '../../types';
import { cn } from '../../lib/utils';

interface IncomeCardStackProps {
  monthIncomes: IncomeEntry[];
  year: number;
  month: number;
  activeFilter: { type: 'FIAT' | 'CRYPTO_SOURCE'; value: string } | null;
  onToggleFilter: (filter: { type: 'FIAT' | 'CRYPTO_SOURCE'; value: string } | null) => void;
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
}

export const IncomeCardStack: React.FC<IncomeCardStackProps> = ({
  monthIncomes,
  year,
  month,
  activeFilter,
  onToggleFilter,
  selectedDate,
  onSelectDate,
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Dragging states
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startY, setStartY] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isSwipeSwipe, setIsSwipeSwipe] = useState(false);
  const [isScrollScroll, setIsScrollScroll] = useState(false);
  const hasDraggedRef = React.useRef(false);
  const isPendingDragRef = React.useRef(false);

  const triggerSwitch = (direction: 'left' | 'right') => {
    if (isTransitioning) return;
    setIsTransitioning(true);

    const flyOffset = direction === 'right' ? 320 : -320;
    setDragOffset(flyOffset);

    // Wait for the slide-out to finish, swap active index, and slide the card back underneath
    setTimeout(() => {
      setActiveIndex((prev) => (prev === 0 ? 1 : 0));
      setDragOffset(0);
      setIsTransitioning(false);
    }, 300);
  };

  // Start drag
  const handleStart = (clientX: number, clientY: number, isNoDragArea: boolean) => {
    if (isTransitioning) return;
    setStartX(clientX);
    setStartY(clientY);
    setDragOffset(0);
    setIsSwipeSwipe(false);
    setIsScrollScroll(false);
    hasDraggedRef.current = false;

    if (isNoDragArea) {
      isPendingDragRef.current = true;
      setIsDragging(false);
    } else {
      isPendingDragRef.current = false;
      setIsDragging(true);
    }
  };

  // Drag in progress
  const handleMove = (clientX: number, clientY: number) => {
    if (isTransitioning) return;
    if (!isDragging && !isPendingDragRef.current) return;

    const deltaX = clientX - startX;
    const deltaY = clientY - startY;

    // Determine direction once a threshold of 6px is reached
    if (!isSwipeSwipe && !isScrollScroll) {
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);
      if (absX > 6 || absY > 6) {
        if (absX > absY) {
          setIsSwipeSwipe(true);
          setIsDragging(true);
          isPendingDragRef.current = false;
        } else {
          setIsScrollScroll(true);
          setIsDragging(false);
          isPendingDragRef.current = false;
          setDragOffset(0);
        }
      }
      return;
    }

    if (isSwipeSwipe && isDragging) {
      setDragOffset(deltaX);
      if (Math.abs(deltaX) > 8) {
        hasDraggedRef.current = true;
      }
    }
  };

  // End drag
  const handleEnd = () => {
    setIsDragging(false);
    setIsSwipeSwipe(false);
    setIsScrollScroll(false);
    isPendingDragRef.current = false;

    if (isTransitioning) return;

    const threshold = 75; // swipe threshold in px
    if (dragOffset > threshold) {
      triggerSwitch('right');
    } else if (dragOffset < -threshold) {
      triggerSwitch('left');
    } else {
      // Snap back to origin
      setDragOffset(0);
    }
  };

  // Mobile Touch events
  const onTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, select, canvas, a')) return;

    // Allow swipe starting inside the [data-no-drag] container, but filter other buttons
    const btn = target.closest('button');
    if (btn && !btn.closest('[data-no-drag="true"]')) return;

    const isNoDragArea = !!target.closest('[data-no-drag="true"]');
    handleStart(e.targetTouches[0].clientX, e.targetTouches[0].clientY, isNoDragArea);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    handleMove(e.targetTouches[0].clientX, e.targetTouches[0].clientY);
  };

  const onTouchEnd = () => {
    handleEnd();
  };

  // Desktop Mouse events
  const onMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, select, canvas, a')) return;

    const btn = target.closest('button');
    if (btn && !btn.closest('[data-no-drag="true"]')) return;

    const isNoDragArea = !!target.closest('[data-no-drag="true"]');
    handleStart(e.clientX, e.clientY, isNoDragArea);
    if (!btn) {
      e.preventDefault(); // Prevents selection
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    handleMove(e.clientX, e.clientY);
  };

  const onMouseUp = () => {
    handleEnd();
  };

  const onMouseLeave = () => {
    if (isDragging) handleEnd();
  };

  // Calculate progress of current swipe (0 to 1)
  const progress = Math.min(Math.abs(dragOffset) / 75, 1);


  // Dynamic Styles for Card 0 (Summary Card)
  const getCard0Style = (): React.CSSProperties => {
    if (activeIndex === 0) {
      // Active Foreground Card (Layer 1)
      if (isDragging || isTransitioning) {
        const rotation = dragOffset * 0.05;
        const translateY = Math.abs(dragOffset) * 0.06;

        return {
          transform: `translate3d(${dragOffset}px, ${translateY}px, 15px) rotate(${rotation}deg)`,
          opacity: 1,
          zIndex: 30,
          willChange: 'transform, opacity',
          transition: isTransitioning ? 'all 300ms cubic-bezier(0.25, 1, 0.5, 1)' : 'none',
        };
      }

      return {
        transform: 'translate3d(0, 0, 0) rotate(0deg)',
        opacity: 1,
        zIndex: 20,
        willChange: 'auto',
        transition: 'all 350ms cubic-bezier(0.175, 0.885, 0.32, 1.275)', // Spring snap back
      };
    } else {
      // Inactive Background Card (Layer 2)
      if (isDragging || isTransitioning) {
        const currentZ = -15 + (0 - -15) * progress;
        const currentRotate = -1.2 + (0 - -1.2) * progress;
        const currentLeft = -6 + (0 - -6) * progress;
        const currentTop = 6 - (6 * progress);
        const currentOpacity = 0.6 + (1 - 0.6) * progress;

        return {
          transform: `translate3d(${currentLeft}px, ${currentTop}px, ${currentZ}px) rotate(${currentRotate}deg)`,
          opacity: currentOpacity,
          zIndex: 20,
          willChange: 'transform, opacity',
          transition: isTransitioning ? 'all 300ms cubic-bezier(0.25, 1, 0.5, 1)' : 'none',
        };
      }

      return {
        transform: 'translate3d(-6px, 6px, -15px) rotate(-1.2deg)',
        opacity: 0.6,
        zIndex: 10,
        willChange: 'auto',
        transition: 'all 350ms cubic-bezier(0.25, 1, 0.5, 1)',
      };
    }
  };

  // Dynamic Styles for Card 1 (Chart Card)
  const getCard1Style = (): React.CSSProperties => {
    if (activeIndex === 1) {
      // Active Foreground Card (Layer 1)
      if (isDragging || isTransitioning) {
        const rotation = dragOffset * 0.05;
        const translateY = Math.abs(dragOffset) * 0.06;

        return {
          transform: `translate3d(${dragOffset}px, ${translateY}px, 15px) rotate(${rotation}deg)`,
          opacity: 1,
          zIndex: 30,
          willChange: 'transform, opacity',
          transition: isTransitioning ? 'all 300ms cubic-bezier(0.25, 1, 0.5, 1)' : 'none',
        };
      }

      return {
        transform: 'translate3d(0, 0, 0) rotate(0deg)',
        opacity: 1,
        zIndex: 20,
        willChange: 'auto',
        transition: 'all 350ms cubic-bezier(0.175, 0.885, 0.32, 1.275)', // Spring snap back
      };
    } else {
      // Inactive Background Card (Layer 2)
      if (isDragging || isTransitioning) {
        const currentZ = -15 + (0 - -15) * progress;
        const currentRotate = -1.2 + (0 - -1.2) * progress;
        const currentLeft = -6 + (0 - -6) * progress;
        const currentTop = 6 - (6 * progress);
        const currentOpacity = 0.6 + (1 - 0.6) * progress;

        return {
          transform: `translate3d(${currentLeft}px, ${currentTop}px, ${currentZ}px) rotate(${currentRotate}deg)`,
          opacity: currentOpacity,
          zIndex: 20,
          willChange: 'transform, opacity',
          transition: isTransitioning ? 'all 300ms cubic-bezier(0.25, 1, 0.5, 1)' : 'none',
        };
      }

      return {
        transform: 'translate3d(-6px, 6px, -15px) rotate(-1.2deg)',
        opacity: 0.6,
        zIndex: 10,
        willChange: 'auto',
        transition: 'all 350ms cubic-bezier(0.25, 1, 0.5, 1)',
      };
    }
  };

  return (
    <div className="flex flex-col gap-3 select-none">

      {/* Stack Deck Area */}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onClickCapture={(e) => {
          if (hasDraggedRef.current) {
            e.stopPropagation();
            e.preventDefault();
            hasDraggedRef.current = false;
          }
        }}
        className={cn(
          "relative h-[280px] w-full transition-all duration-150",
          isDragging ? "cursor-grabbing" : "cursor-grab"
        )}
        style={{ perspective: '1000px', transformStyle: 'preserve-3d' }}
      >

        {/* Card 0: Summary Card */}
        <div
          style={getCard0Style()}
          className="absolute w-full h-full"
        >
          <IncomeSummaryCard activeFilter={activeFilter} onToggleFilter={onToggleFilter} />
        </div>

        {/* Card 1: Chart Card */}
        <div
          style={getCard1Style()}
          className="absolute w-full h-full"
        >
          <IncomeChartCard
            monthIncomes={monthIncomes}
            year={year}
            month={month}
            selectedDate={selectedDate}
            onSelectDate={onSelectDate}
          />
        </div>
      </div>
    </div>
  );
};
