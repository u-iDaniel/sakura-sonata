"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Settings, ChevronLeft, ChevronRight, Check } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────

export interface SettingsMenuItem {
  id: string;
  label: string;
  /** Current value shown on the right of each row (e.g. "1×", "Splendid Grand") */
  currentValue?: string;
  icon?: React.ReactNode;
  /** Panel rendered when the user drills into this item */
  panel: React.ReactNode;
}

interface FullscreenSettingsMenuProps {
  items: SettingsMenuItem[];
  /** Notify parent when menu opens / closes so the overlay can stay visible */
  onOpenChange?: (open: boolean) => void;
}

// ── Component ─────────────────────────────────────────────────────────

export function FullscreenSettingsMenu({
  items,
  onOpenChange,
}: FullscreenSettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [slideDir, setSlideDir] = useState<"left" | "right">("left");
  const menuRef = useRef<HTMLDivElement | null>(null);

  const toggleOpen = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (!next) setActivePanel(null);
      onOpenChange?.(next);
      return next;
    });
  }, [onOpenChange]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setActivePanel(null);
    onOpenChange?.(false);
  }, [onOpenChange]);

  const openPanel = useCallback((id: string) => {
    setSlideDir("left");
    setActivePanel(id);
  }, []);

  const goBack = useCallback(() => {
    setSlideDir("right");
    setActivePanel(null);
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeMenu();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, closeMenu]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    // Use a timeout so the opening click doesn't immediately close
    const t = setTimeout(() => {
      document.addEventListener("pointerdown", onClick, true);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", onClick, true);
    };
  }, [open, closeMenu]);

  const activePanelItem = activePanel
    ? items.find((it) => it.id === activePanel)
    : null;

  return (
    <div ref={menuRef} className="relative">
      {/* Gear button */}
      <button
        onClick={toggleOpen}
        className={`flex items-center justify-center w-9 h-9 rounded-full transition-colors ${
          open
            ? "bg-white/20 text-white"
            : "text-white/80 hover:text-white hover:bg-white/10"
        }`}
        aria-label="Settings"
        title="Settings"
      >
        <Settings className="w-5 h-5" />
      </button>

      {/* Menu popup */}
      {open && (
        <div
          className="absolute bottom-full right-0 mb-2 w-72 rounded-xl bg-neutral-900/95 backdrop-blur-lg border border-white/10 shadow-2xl overflow-hidden"
          style={{ maxHeight: "min(400px, 60vh)" }}
        >
          <div className="relative overflow-hidden">
            {/* ── Main list ────────────────────────────────── */}
            <div
              className={`transition-transform duration-200 ease-in-out ${
                activePanel
                  ? slideDir === "left"
                    ? "-translate-x-full"
                    : "-translate-x-full"
                  : "translate-x-0"
              }`}
              style={{ display: activePanel ? "none" : undefined }}
            >
              <div className="py-2">
                {items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => openPanel(item.id)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-white/90 hover:bg-white/10 transition-colors"
                  >
                    {item.icon && (
                      <span className="w-5 h-5 flex items-center justify-center text-white/60">
                        {item.icon}
                      </span>
                    )}
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.currentValue && (
                      <span className="text-xs text-white/50 mr-1">
                        {item.currentValue}
                      </span>
                    )}
                    <ChevronRight className="w-4 h-4 text-white/40" />
                  </button>
                ))}
              </div>
            </div>

            {/* ── Sub-panel ────────────────────────────────── */}
            {activePanel && activePanelItem && (
              <div
                className={`transition-transform duration-200 ease-in-out ${
                  slideDir === "left"
                    ? "animate-in slide-in-from-right"
                    : "animate-in slide-in-from-left"
                }`}
              >
                {/* Header with back */}
                <button
                  onClick={goBack}
                  className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-white/90 hover:bg-white/10 transition-colors border-b border-white/10"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>{activePanelItem.label}</span>
                </button>
                {/* Panel content */}
                <div className="py-2 max-h-[min(320px,50vh)] overflow-y-auto">
                  {activePanelItem.panel}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Reusable sub-panel building blocks ────────────────────────────────

/** A radio-style option row for use inside a settings sub-panel */
export function SettingsRadioItem({
  label,
  description,
  selected,
  onClick,
}: {
  label: string;
  description?: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-white/90 hover:bg-white/10 transition-colors"
    >
      <span
        className={`w-5 h-5 flex items-center justify-center ${
          selected ? "text-pink-400" : "text-transparent"
        }`}
      >
        <Check className="w-4 h-4" />
      </span>
      <div className="flex-1 text-left">
        <div>{label}</div>
        {description && (
          <div className="text-xs text-white/40">{description}</div>
        )}
      </div>
    </button>
  );
}

/** A generic action row */
export function SettingsActionItem({
  label,
  icon,
  onClick,
  disabled,
  description,
}: {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  description?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-white/90 hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {icon && (
        <span className="w-5 h-5 flex items-center justify-center text-white/60">
          {icon}
        </span>
      )}
      <div className="flex-1 text-left">
        <div>{label}</div>
        {description && (
          <div className="text-xs text-white/40">{description}</div>
        )}
      </div>
    </button>
  );
}
