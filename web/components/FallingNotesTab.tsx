"use client";

import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import {
  Play,
  Pause,
  Square,
  RotateCcw,
  RotateCw,
  Download,
  X,
  Minimize2,
  Loader2,
  Maximize2,
} from "lucide-react";
import * as Tone from "tone";
import type { Midi } from "@tonejs/midi";
import type {
  MidiPlayerState,
  MidiPlayerControls,
  NoteEvent,
} from "@/lib/hooks/useMidiPlayer";
import type { PianoPlayerFactory } from "@/lib/piano";
import { splendidPiano } from "@/lib/piano";
import { isBlackKey, buildKeyLayout } from "@/lib/piano/canvas-utils";
import { drawFallingNotesFrame } from "@/lib/piano/draw-frame";
import { useVideoExport } from "@/lib/hooks/useVideoExport";
import { FullscreenOverlay } from "@/components/FullscreenOverlay";
import {
  FullscreenSettingsMenu,
  SettingsRadioItem,
  SettingsActionItem,
  type SettingsMenuItem,
} from "@/components/FullscreenSettingsMenu";

// ── Component ─────────────────────────────────────────────────────────

export interface PianoOption {
  value: string;
  label: string;
  description: string;
  factory: PianoPlayerFactory;
}

interface FallingNotesTabProps {
  state: MidiPlayerState;
  controls: MidiPlayerControls;
  isFullscreen?: boolean;
  pianoSwitcher?: React.ReactNode;
  playbackSpeed?: number;
  /** Required for video export – ref to the parsed Midi object */
  midiRef?: React.RefObject<Midi | null>;
  /** Required for video export – factory to create piano for offline audio rendering */
  pianoFactory?: PianoPlayerFactory;
  /** Fullscreen settings – exit callback */
  onExitFullscreen?: () => void;
  /** Fullscreen settings – playback speed setter */
  setPlaybackSpeed?: (speed: number) => void;
  /** Fullscreen settings – original BPM for speed ↔ BPM conversion */
  originalBpm?: number;
  /** Fullscreen settings – available piano samplers */
  pianoOptions?: PianoOption[];
  /** Fullscreen settings – currently selected piano key */
  pianoKey?: string;
  /** Fullscreen settings – piano key setter */
  setPianoKey?: (key: string) => void;
  /** Toggle fullscreen mode (for normal mode button) */
  toggleFullscreen?: () => void;
}

const LARGE_FILE_THRESHOLD_SECS = 120; // 2 minutes

const SPEED_PRESETS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2] as const;

export function FallingNotesTab({
  state,
  controls,
  isFullscreen = false,
  pianoSwitcher,
  playbackSpeed = 1,
  midiRef,
  pianoFactory = splendidPiano,
  onExitFullscreen,
  setPlaybackSpeed,
  originalBpm,
  pianoOptions,
  pianoKey,
  setPianoKey,
  toggleFullscreen,
}: FallingNotesTabProps) {
  const { isPlaying, loadState, duration, progress, pianoLoading } = state;
  const {
    togglePlayback,
    stopPlayback,
    seekTo,
    skip,
    formatTime,
    getAllNotes,
  } = controls;
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const isLargeFile = duration > LARGE_FILE_THRESHOLD_SECS;

  // Video export
  const {
    exportVideo,
    exportProgress,
    isExporting,
    exportError,
    cancelExport,
  } = useVideoExport();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number>(0);
  const notesCache = useRef<NoteEvent[]>([]);

  const bassTrack = useMemo(() => {
    const notes = getAllNotes();
    if (notes.length === 0) return -1;

    const trackPitchSums = new Map<number, { sum: number; count: number }>();
    for (const n of notes) {
      const entry = trackPitchSums.get(n.track) ?? { sum: 0, count: 0 };
      entry.sum += n.midi;
      entry.count++;
      trackPitchSums.set(n.track, entry);
    }

    if (trackPitchSums.size < 2) return -1;

    let lowestAvg = Infinity;
    let lowestTrack = -1;
    for (const [track, { sum, count }] of trackPitchSums) {
      const avg = sum / count;
      if (avg < lowestAvg) {
        lowestAvg = avg;
        lowestTrack = track;
      }
    }
    return lowestTrack;
  }, [getAllNotes]);

  const layout = useMemo(() => {
    const notes = getAllNotes();
    notesCache.current = notes;
    if (notes.length === 0) return null;

    let minMidi = 127;
    let maxMidi = 0;
    for (const n of notes) {
      if (n.midi < minMidi) minMidi = n.midi;
      if (n.midi > maxMidi) maxMidi = n.midi;
    }

    minMidi = Math.max(21, minMidi - 2);
    maxMidi = Math.min(108, maxMidi + 2);

    while (isBlackKey(minMidi)) minMidi--;
    while (isBlackKey(maxMidi)) maxMidi++;

    const kb = buildKeyLayout(minMidi, maxMidi);
    return { ...kb, minMidi, maxMidi };
  }, [getAllNotes]);

  const seekFromPointer = useCallback(
    (clientX: number, bar: HTMLElement) => {
      if (duration <= 0) return;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(
        0,
        Math.min(1, (clientX - rect.left) / rect.width),
      );
      seekTo(ratio * duration);
    },
    [duration, seekTo],
  );

  const handleBarPointerDown = useCallback(
    (e: React.PointerEvent) => {
      setIsScrubbing(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      seekFromPointer(e.clientX, e.currentTarget as HTMLElement);
    },
    [seekFromPointer],
  );

  const handleBarPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isScrubbing) return;
      seekFromPointer(e.clientX, e.currentTarget as HTMLElement);
    },
    [isScrubbing, seekFromPointer],
  );

  const handleBarPointerUp = useCallback(() => {
    setIsScrubbing(false);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    return () => observer.disconnect();
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;

    const currentTime = Tone.getTransport().seconds * playbackSpeed;

    drawFallingNotesFrame(ctx, W, H, currentTime, {
      notes: notesCache.current,
      layout,
      bassTrack,
      duration,
      formatTime,
    });
  }, [layout, bassTrack, duration, formatTime, playbackSpeed]);

  const handleExportVideo = useCallback(() => {
    if (!layout || isExporting) return;
    stopPlayback();

    exportVideo({
      notes: notesCache.current,
      layout,
      bassTrack,
      duration,
      playbackSpeed,
      formatTime,
      midiRef: midiRef!,
      pianoFactory,
      title: state.title,
      bpm: state.bpm,
    });
  }, [
    layout,
    bassTrack,
    duration,
    playbackSpeed,
    formatTime,
    midiRef,
    pianoFactory,
    isExporting,
    exportVideo,
    stopPlayback,
    state.title,
    state.bpm,
  ]);

  useEffect(() => {
    let running = true;

    function tick() {
      if (!running) return;
      draw();
      rafRef.current = requestAnimationFrame(tick);
    }

    tick();
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [draw]);

  // ── Fullscreen settings menu items ─────────────────────────────────
  const fsSettingsItems = useMemo((): SettingsMenuItem[] => {
    if (!isFullscreen) return [];
    const items: SettingsMenuItem[] = [];

    // Playback Speed
    if (setPlaybackSpeed && originalBpm) {
      const activePreset = SPEED_PRESETS.find(
        (p) => Math.abs(p - playbackSpeed) < 0.005,
      );
      items.push({
        id: "speed",
        label: "Playback Speed",
        currentValue: activePreset
          ? `${activePreset}×`
          : `${Math.round(playbackSpeed * originalBpm)} BPM`,
        panel: (
          <div className="px-2 py-1 space-y-3">
            {/* Preset pills */}
            <div className="flex flex-wrap gap-1.5 px-2">
              {SPEED_PRESETS.map((preset) => (
                <button
                  key={preset}
                  onClick={() => setPlaybackSpeed(preset)}
                  className={`px-2.5 py-1.5 text-xs rounded-full transition-colors ${
                    activePreset === preset
                      ? "bg-pink-400 text-white"
                      : "text-white/70 hover:bg-white/10 border border-white/20"
                  }`}
                >
                  {preset}×
                </button>
              ))}
            </div>
            {/* BPM input */}
            <div className="flex items-center gap-2 px-2">
              <span className="text-xs text-white/50">BPM</span>
              <input
                type="number"
                min={1}
                step={1}
                defaultValue={Math.round(playbackSpeed * originalBpm)}
                key={playbackSpeed}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v > 0)
                    setPlaybackSpeed(v / originalBpm);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="w-16 border border-white/20 rounded-full px-2.5 py-1.5 text-center text-xs text-white bg-white/10 outline-none focus:border-pink-400 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
          </div>
        ),
      });
    }

    // Piano Sound
    if (pianoOptions && pianoKey && setPianoKey) {
      const currentLabel =
        pianoOptions.find((o) => o.value === pianoKey)?.label ?? pianoKey;
      items.push({
        id: "piano",
        label: "Piano Sound",
        currentValue: currentLabel,
        panel: (
          <div>
            {pianoOptions.map((opt) => (
              <SettingsRadioItem
                key={opt.value}
                label={opt.label}
                description={opt.description}
                selected={pianoKey === opt.value}
                onClick={() => setPianoKey(opt.value)}
              />
            ))}
          </div>
        ),
      });
    }

    return items;
  }, [
    isFullscreen,
    playbackSpeed,
    setPlaybackSpeed,
    originalBpm,
    pianoOptions,
    pianoKey,
    setPianoKey,
    midiRef,
  ]);

  if (loadState !== "ready") return null;

  // ── Fullscreen layout ───────────────────────────────────────────────
  if (isFullscreen) {
    const progressPct = duration > 0 ? (progress / duration) * 100 : 0;

    const canvasEl = (
      <div ref={containerRef} className="w-full h-full relative">
        <canvas ref={canvasRef} className="block w-full h-full" />
        {pianoLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
            <div className="flex items-center gap-2 text-white/80 text-sm">
              <Loader2 className="w-5 h-5 animate-spin text-pink-400" />
              <span>Loading piano…</span>
            </div>
          </div>
        )}
      </div>
    );

    return (
      <div className="absolute inset-0">
        <FullscreenOverlay
          keepVisible={!isPlaying || settingsOpen || isScrubbing}
          canvasContent={canvasEl}
          onBackdropClick={togglePlayback}
        >
          {/* Progress bar – full width above controls */}
          <div
            ref={progressBarRef}
            className="w-full relative cursor-pointer group mb-3"
            onPointerDown={handleBarPointerDown}
            onPointerMove={handleBarPointerMove}
            onPointerUp={handleBarPointerUp}
            onPointerCancel={handleBarPointerUp}
          >
            <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden group-hover:h-1.5 transition-all">
              <div
                className="h-full bg-pink-400 rounded-full transition-[width] duration-75"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
              style={{ left: `calc(${progressPct}% - 6px)` }}
            />
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-3">
            {/* Play / Pause */}
            <button
              onClick={togglePlayback}
              className="flex items-center justify-center w-10 h-10 text-white hover:text-pink-300 transition-colors"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5" />
              ) : (
                <Play className="w-5 h-5 ml-0.5" />
              )}
            </button>

            {/* Rewind / Forward / Stop */}
            <button
              onClick={() => skip(-5)}
              className="text-white/70 hover:text-white transition-colors"
              aria-label="Rewind 5 seconds"
              title="Rewind 5s"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={() => skip(5)}
              className="text-white/70 hover:text-white transition-colors"
              aria-label="Forward 5 seconds"
              title="Forward 5s"
            >
              <RotateCw className="w-4 h-4" />
            </button>
            <button
              onClick={stopPlayback}
              className="text-white/70 hover:text-white transition-colors"
              aria-label="Stop"
            >
              <Square className="w-4 h-4" />
            </button>

            {/* Time */}
            <span className="text-xs text-white/60 tabular-nums ml-1">
              {formatTime(progress)} / {formatTime(duration)}
            </span>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Settings gear */}
            {fsSettingsItems.length > 0 && (
              <FullscreenSettingsMenu
                items={fsSettingsItems}
                onOpenChange={setSettingsOpen}
              />
            )}

            {/* Exit fullscreen */}
            {onExitFullscreen && (
              <button
                onClick={onExitFullscreen}
                className="text-white/70 hover:text-white transition-colors"
                aria-label="Exit fullscreen"
                title="Exit fullscreen (Esc)"
              >
                <Minimize2 className="w-5 h-5" />
              </button>
            )}
          </div>
        </FullscreenOverlay>
      </div>
    );
  }

  // ── Normal (non-fullscreen) layout ──────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Canvas container */}
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-2xl border border-pink-200/40"
        style={{ height: "min(60vh, 520px)" }}
      >
        <canvas ref={canvasRef} className="block w-full h-full" />

        {pianoLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-10 rounded-2xl">
            <div className="flex items-center gap-2 text-white/90 text-sm">
              <Loader2 className="w-5 h-5 animate-spin text-pink-400" />
              <span>Loading piano…</span>
            </div>
          </div>
        )}

        {!isPlaying && progress === 0 && !pianoLoading && (
          <button
            onClick={togglePlayback}
            className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors group"
            aria-label="Play"
          >
            <div className="w-16 h-16 rounded-full bg-pink-400/90 group-hover:bg-pink-500 flex items-center justify-center shadow-xl transition-colors">
              <Play className="w-7 h-7 text-white ml-1" />
            </div>
          </button>
        )}
      </div>

      {/* Controls */}
      <div className="space-y-3">
        {/* ══ MOBILE LAYOUT (md:hidden) ══ */}
        <div className="md:hidden space-y-3">
          {/* Mobile Row 1: Time + Progress bar + Fullscreen */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 tabular-nums whitespace-nowrap">
              {formatTime(progress)} / {formatTime(duration)}
            </span>
            <div
              ref={progressBarRef}
              className="flex-1 min-w-[60px] relative cursor-pointer group"
              onPointerDown={handleBarPointerDown}
              onPointerMove={handleBarPointerMove}
              onPointerUp={handleBarPointerUp}
              onPointerCancel={handleBarPointerUp}
            >
              <div className="w-full h-2 bg-pink-100 rounded-full overflow-hidden group-hover:h-2.5 transition-all">
                <div
                  className="h-full bg-gradient-to-r from-pink-300 to-pink-400 rounded-full transition-[width] duration-75"
                  style={{
                    width: `${duration > 0 ? (progress / duration) * 100 : 0}%`,
                  }}
                />
              </div>
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white border-2 border-pink-400 rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                style={{
                  left: `calc(${duration > 0 ? (progress / duration) * 100 : 0}% - 6px)`,
                }}
              />
            </div>
            {toggleFullscreen && (
              <button
                onClick={toggleFullscreen}
                className="flex items-center justify-center w-9 h-9 rounded-full bg-white border border-pink-200 text-pink-400 hover:bg-pink-50 transition-colors"
                aria-label="Enter fullscreen"
                title="Fullscreen"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Mobile Row 2: Transport controls */}
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => skip(-5)}
              className="flex items-center justify-center w-9 h-9 rounded-full bg-white border border-pink-200 text-pink-400 hover:bg-pink-50 transition-colors"
              aria-label="Rewind 5 seconds"
              title="Rewind 5s"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={togglePlayback}
              className="flex items-center justify-center w-12 h-12 rounded-full bg-pink-400 hover:bg-pink-500 text-white transition-colors shadow-lg hover:shadow-xl"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5" />
              ) : (
                <Play className="w-5 h-5 ml-0.5" />
              )}
            </button>
            <button
              onClick={() => skip(5)}
              className="flex items-center justify-center w-9 h-9 rounded-full bg-white border border-pink-200 text-pink-400 hover:bg-pink-50 transition-colors"
              aria-label="Forward 5 seconds"
              title="Forward 5s"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={stopPlayback}
              className="flex items-center justify-center w-9 h-9 rounded-full bg-white border border-pink-200 text-pink-400 hover:bg-pink-50 transition-colors"
              aria-label="Stop"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Mobile Row 3: Export video + Piano switcher */}
          <div className="flex items-center justify-center gap-3">
            {midiRef && (
              <div className="flex flex-col items-center gap-1">
                {isExporting ? (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 rounded-full bg-pink-50 border border-pink-200 px-3 py-1.5 text-xs text-pink-600 min-w-[7rem]">
                      <Download className="w-3.5 h-3.5 animate-pulse" />
                      <span>Exporting {exportProgress ?? 0}%</span>
                    </div>
                    <button
                      onClick={cancelExport}
                      className="flex items-center justify-center w-7 h-7 rounded-full bg-white border border-pink-200 text-pink-400 hover:bg-pink-50 transition-colors"
                      aria-label="Cancel export"
                      title="Cancel export"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div className="relative group">
                    <button
                      onClick={handleExportVideo}
                      className="flex items-center gap-1.5 rounded-full bg-white border border-pink-200 text-pink-400 hover:bg-pink-50 hover:text-pink-600 transition-colors px-3 py-1.5 text-xs"
                      aria-label="Export video"
                      title={
                        isLargeFile
                          ? undefined
                          : "Export falling notes as video"
                      }
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export Video
                    </button>
                    {isLargeFile && (
                      <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block z-50">
                        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs px-3 py-2 whitespace-nowrap shadow-md">
                          ⚠ This piece is long — export may take several
                          minutes.
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {exportError && (
                  <span
                    className="text-xs text-red-500 text-center"
                    title={exportError}
                  >
                    Export failed
                  </span>
                )}
              </div>
            )}
            {pianoSwitcher && <div>{pianoSwitcher}</div>}
          </div>
        </div>

        {/* ══ DESKTOP LAYOUT (hidden md:flex) ══ */}
        <div className="hidden md:flex items-center justify-center gap-3 shrink-0 flex-wrap">
          <button
            onClick={() => skip(-5)}
            className="flex items-center justify-center w-9 h-9 rounded-full bg-white border border-pink-200 text-pink-400 hover:bg-pink-50 transition-colors"
            aria-label="Rewind 5 seconds"
            title="Rewind 5s"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={togglePlayback}
            className="flex items-center justify-center w-12 h-12 rounded-full bg-pink-400 hover:bg-pink-500 text-white transition-colors shadow-lg hover:shadow-xl"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5" />
            ) : (
              <Play className="w-5 h-5 ml-0.5" />
            )}
          </button>
          <button
            onClick={() => skip(5)}
            className="flex items-center justify-center w-9 h-9 rounded-full bg-white border border-pink-200 text-pink-400 hover:bg-pink-50 transition-colors"
            aria-label="Forward 5 seconds"
            title="Forward 5s"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={stopPlayback}
            className="flex items-center justify-center w-9 h-9 rounded-full bg-white border border-pink-200 text-pink-400 hover:bg-pink-50 transition-colors"
            aria-label="Stop"
          >
            <Square className="w-3.5 h-3.5" />
          </button>

          {/* Progress bar */}
          <div
            ref={progressBarRef}
            className="flex-1 max-w-xs relative cursor-pointer group"
            onPointerDown={handleBarPointerDown}
            onPointerMove={handleBarPointerMove}
            onPointerUp={handleBarPointerUp}
            onPointerCancel={handleBarPointerUp}
          >
            <div className="w-full h-2 bg-pink-100 rounded-full overflow-hidden group-hover:h-2.5 transition-all">
              <div
                className="h-full bg-gradient-to-r from-pink-300 to-pink-400 rounded-full transition-[width] duration-75"
                style={{
                  width: `${duration > 0 ? (progress / duration) * 100 : 0}%`,
                }}
              />
            </div>
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white border-2 border-pink-400 rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
              style={{
                left: `calc(${duration > 0 ? (progress / duration) * 100 : 0}% - 6px)`,
              }}
            />
          </div>
          <span className="text-xs text-slate-400 tabular-nums min-w-[4rem] text-right">
            {formatTime(progress)} / {formatTime(duration)}
          </span>

          {/* Export Video button */}
          {midiRef && (
            <div className="flex flex-col items-end gap-1 ml-2">
              {isExporting ? (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 rounded-full bg-pink-50 border border-pink-200 px-3 py-1.5 text-xs text-pink-600 min-w-[7rem]">
                    <Download className="w-3.5 h-3.5 animate-pulse" />
                    <span>Exporting {exportProgress ?? 0}%</span>
                  </div>
                  <button
                    onClick={cancelExport}
                    className="flex items-center justify-center w-7 h-7 rounded-full bg-white border border-pink-200 text-pink-400 hover:bg-pink-50 transition-colors"
                    aria-label="Cancel export"
                    title="Cancel export"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="relative group">
                  <button
                    onClick={handleExportVideo}
                    className="flex items-center gap-1.5 rounded-full bg-white border border-pink-200 text-pink-400 hover:bg-pink-50 hover:text-pink-600 transition-colors px-3 py-1.5 text-xs"
                    aria-label="Export video"
                    title={
                      isLargeFile ? undefined : "Export falling notes as video"
                    }
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Export Video</span>
                  </button>
                  {isLargeFile && (
                    <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block z-50">
                      <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs px-3 py-2 whitespace-nowrap shadow-md">
                        ⚠ This piece is long — export may take several minutes.
                      </div>
                    </div>
                  )}
                </div>
              )}
              {exportError && (
                <span
                  className="text-xs text-red-500 text-right"
                  title={exportError}
                >
                  Export failed
                </span>
              )}
            </div>
          )}

          {pianoSwitcher && <div className="ml-1">{pianoSwitcher}</div>}

          {/* Fullscreen button */}
          {toggleFullscreen && (
            <button
              onClick={toggleFullscreen}
              className="ml-1 flex items-center justify-center w-9 h-9 rounded-full bg-white border border-pink-200 text-pink-400 hover:bg-pink-50 transition-colors"
              aria-label="Enter fullscreen"
              title="Fullscreen"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
