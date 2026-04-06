import React from 'react';
import { cn } from '../../lib/utils';

// ============================================================
//  CARD COMPONENT — Neo-brutalism card container
// ============================================================

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** If true, removes the offset shadow (flat look) */
  flat?: boolean;
  /** If true, applies a yellow background like the page bg */
  highlight?: boolean;
  /** onClick becomes interactive: cursor-pointer + hover translateY */
  clickable?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, flat, highlight, clickable, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'neo-card',
          flat && '!shadow-none',
          highlight && '!bg-brutal-yellow',
          clickable && [
            'cursor-pointer',
            'hover:-translate-y-0.5 hover:shadow-[8px_8px_0px_0px_#000]',
            'active:translate-x-1.5 active:translate-y-1.5 active:!shadow-none',
          ],
          'transition-all duration-150',
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';

// ── Sub-components ────────────────────────────────────────────

type CardHeaderProps = React.HTMLAttributes<HTMLDivElement>;
const CardHeader = React.forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('px-4 pt-4 pb-2', className)}
      {...props}
    >
      {children}
    </div>
  )
);
CardHeader.displayName = 'CardHeader';

type CardBodyProps = React.HTMLAttributes<HTMLDivElement>;
const CardBody = React.forwardRef<HTMLDivElement, CardBodyProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('px-4 py-3', className)}
      {...props}
    >
      {children}
    </div>
  )
);
CardBody.displayName = 'CardBody';

type CardFooterProps = React.HTMLAttributes<HTMLDivElement>;
const CardFooter = React.forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('px-4 pt-2 pb-4 border-t-2 border-[#555555] mt-2', className)}
      {...props}
    >
      {children}
    </div>
  )
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardBody, CardFooter };
export type { CardProps };
