"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// ── Constants ─────────────────────────────────────────────────────────

const IDLE_TIMEOUT_MS = 3000;

// ── Props ─────────────────────────────────────────────────────────────

interface FullscreenOverlayProps {
  /** Keep controls visible (e.g. when paused, idle, settings open) */
  keepVisible?: boolean;
  /** Content rendered in the bottom control bar overlay */
  children: React.ReactNode;
  /** Canvas / main content that fills the screen */
  canvasContent: React.ReactNode;
  /** Called when the user clicks the empty area (not controls) — can be used for play/pause toggle */
  onBackdropClick?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────

export function FullscreenOverlay({
  keepVisible = false,
  children,
  canvasContent,
  onBackdropClick,
}: FullscreenOverlayProps) {
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const resetTimer = useCallback(() => {
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!keepVisible) {
      timerRef.current = setTimeout(() => setVisible(false), IDLE_TIMEOUT_MS);
    }
  }, [keepVisible]);

  // When keepVisible changes, update visibility
  useEffect(() => {
    if (keepVisible) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setVisible(true);
    } else {
      // Start the hide timer
      resetTimer();
    }
  }, [keepVisible, resetTimer]);

  // Mouse / touch activity listeners
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onActivity = () => resetTimer();

    el.addEventListener("mousemove", onActivity);
    el.addEventListener("touchstart", onActivity, { passive: true });
    el.addEventListener("pointerdown", onActivity);

    return () => {
      el.removeEventListener("mousemove", onActivity);
      el.removeEventListener("touchstart", onActivity);
      el.removeEventListener("pointerdown", onActivity);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [resetTimer]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative bg-black overflow-hidden"
      style={{ cursor: visible ? "default" : "none" }}
    >
      {/* Main content (canvas) — fills the entire area */}
      <div className="absolute inset-0">{canvasContent}</div>

      {/* Click-to-toggle backdrop — above canvas, below controls */}
      {onBackdropClick && (
        <div className="absolute inset-0 z-10" onClick={onBackdropClick} />
      )}

      {/* Bottom gradient overlay with controls */}
      <div
        className={`absolute inset-x-0 bottom-0 z-20 transition-all duration-300 ${
          visible
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-4 pointer-events-none"
        }`}
      >
        {/* Gradient backdrop */}
        <div className="bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-16 pb-4 px-4 md:px-6">
          {children}
        </div>
      </div>
    </div>
  );
}
