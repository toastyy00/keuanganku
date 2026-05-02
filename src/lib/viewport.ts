const APP_VIEWPORT_HEIGHT_VAR = '--app-viewport-height';

function isPinchZoomActive(): boolean {
  const scale = window.visualViewport?.scale;
  return typeof scale === 'number' && Number.isFinite(scale) && Math.abs(scale - 1) > 0.01;
}

function getViewportHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight;
}

function applyViewportHeight(): void {
  if (isPinchZoomActive()) return;

  const height = getViewportHeight();
  if (!Number.isFinite(height) || height <= 0) return;

  document.documentElement.style.setProperty(
    APP_VIEWPORT_HEIGHT_VAR,
    `${height}px`,
  );
}

function resetDocumentScroll(): void {
  if (window.scrollX === 0 && window.scrollY === 0) return;
  window.scrollTo({ left: 0, top: 0, behavior: 'auto' });
}

export function installAppViewportGuards(): () => void {
  if (typeof window === 'undefined') return () => undefined;

  if ('scrollRestoration' in window.history) {
    window.history.scrollRestoration = 'manual';
  }

  let frameId: number | null = null;
  const scheduleViewportUpdate = () => {
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId);
    }

    frameId = window.requestAnimationFrame(() => {
      frameId = null;
      applyViewportHeight();
      resetDocumentScroll();
    });
  };

  applyViewportHeight();
  resetDocumentScroll();

  window.requestAnimationFrame(() => {
    applyViewportHeight();
    resetDocumentScroll();
  });

  window.addEventListener('resize', scheduleViewportUpdate);
  window.addEventListener('orientationchange', scheduleViewportUpdate);
  window.addEventListener('pageshow', scheduleViewportUpdate);
  window.visualViewport?.addEventListener('resize', scheduleViewportUpdate);

  return () => {
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId);
    }

    window.removeEventListener('resize', scheduleViewportUpdate);
    window.removeEventListener('orientationchange', scheduleViewportUpdate);
    window.removeEventListener('pageshow', scheduleViewportUpdate);
    window.visualViewport?.removeEventListener('resize', scheduleViewportUpdate);
  };
}
