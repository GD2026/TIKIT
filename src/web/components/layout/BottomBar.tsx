import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * Floating glass accessory for the screen's primary action. Inside the tab-bar shell it rides just above
 * the tab bar (like the iOS tab bar accessory); on full-screen routes it sits above the home indicator.
 */
export function BottomBar({ children, aboveTabBar = false, className }: { children: ReactNode; aboveTabBar?: boolean; className?: string }) {
  return (
    <>
      <div aria-hidden="true" className={cn('shrink-0', aboveTabBar ? 'h-24' : 'h-[calc(96px+var(--safe-bottom))]')} />
      <div
        className={cn(
          'pointer-events-none fixed inset-x-0 z-30 flex justify-center px-3',
          aboveTabBar ? 'bottom-[calc(var(--tabbar-height)+max(var(--tabbar-gap),var(--safe-bottom))+10px)] lg:bottom-6' : 'bottom-[max(12px,var(--safe-bottom))]',
        )}
        style={{ left: 'var(--sidebar-w, 0px)' }}
      >
        <div className={cn('glass pointer-events-auto w-full max-w-[600px] rounded-[28px] p-2', className)}>{children}</div>
      </div>
    </>
  );
}
