"use client";

import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronUp,
  SkipForward,
  Minimize2,
  Maximize2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import type {
  MidiPlayerState,
  MidiPlayerControls,
  MidiPlayerRefs,
  NoteEvent,
} from "@/lib/hooks/useMidiPlayer";
import { usePracticeMode } from "@/lib/hooks/usePracticeMode";
import type { FlowingJudgment } from "@/lib/piano/midi-helpers";
import {
  isBlackKey,
  buildKeyLayout,
  keyPosition,
  midiToNoteName,
  noteColor,
  ACTIVE_KEY_COLOR,
  WHITE_KEY_COLOR,
  BLACK_KEY_COLOR,
  KEY_BORDER_COLOR,
  CANVAS_BG,
  HIT_LINE_COLOR,
  EXPECTED_KEY_COLOR,
  WRONG_KEY_COLOR,
} from "@/lib/piano/canvas-utils";
import { FullscreenOverlay } from "@/components/FullscreenOverlay";
import {
  FullscreenSettingsMenu,
  SettingsRadioItem,
  type SettingsMenuItem,
} from "@/components/FullscreenSettingsMenu";
import type { PianoOption } from "@/components/FallingNotesTab";

// ── Constants ─────────────────────────────────────────────────────────

const LOOK_AHEAD = 4;
const KEYBOARD_HEIGHT_RATIO = 0.15;
const BLACK_KEY_HEIGHT_RATIO = 0.6;
const MIN_BAR_PX = 6;

// Judgment display constants
const JUDGMENT_DURATION_MS = 1200;
const JUDGMENT_FLOAT_PX = 40;

// ── Props ─────────────────────────────────────────────────────────────

interface PracticeTabProps {
  state: MidiPlayerState;
  controls: MidiPlayerControls;
  refs: MidiPlayerRefs;
  isFullscreen?: boolean;
  pianoSwitcher?: React.ReactNode;
  playbackSpeed?: number;
  /** Fullscreen settings – exit callback */
  onExitFullscreen?: () => void;
  /** Fullscreen settings – playback speed setter */
  setPlaybackSpeed?: (speed: number) => void;
  /** Fullscreen settings – original BPM */
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

// ── In-memory summary (no DB) ─────────────────────────────────────────
// This does NOT change your practice logic at all — it only summarizes
// whatever is already in `sessionLog` for Gemini.
type PracticeSummary = {
  pieceTitle: string;
  mode: "discrete" | "continuous" | "flowing";
  totalSteps: number;

  attempts: number;
  hits: number;
  wrongs: number;
  accuracyPct: number;

  // If your sessionLog includes per-event info, we’ll pick it up.
  // Otherwise these will just be empty arrays.
  topWrong: { midi: number; note: string; count: number }[];
  topMissed: { midi: number; note: string; count: number }[];
  hotspots: { step: number; fails: number }[];
  playbackSpeed: number;
};

function buildPracticeSummary(args: {
  sessionLog: any[];
  totalSteps: number;
  flowingTotalNotes: number;
  pieceTitle: string;
  mode: "discrete" | "continuous" | "flowing";
  playbackSpeed: number;
}): PracticeSummary {
  const {
    sessionLog,
    totalSteps,
    flowingTotalNotes,
    pieceTitle,
    mode,
    playbackSpeed,
  } = args;

  const wrongByMidi = new Map<number, number>();
  const missedByMidi = new Map<number, number>();
  const failsByStep = new Map<number, number>();

  let hits = 0;
  let wrongs = 0;

  // Fix 1: track unique steps to avoid inflating attempts on retries
  const uniqueSteps = new Set<number>();

  for (const e of sessionLog) {
    const correct = !!e?.correct;

    if (typeof e?.stepIndex === "number" && e.stepIndex >= 0) {
      uniqueSteps.add(e.stepIndex);
    }

    if (correct) {
      hits++;
      continue;
    }
    wrongs++;

    // Fix 3: only populate hotspots if stepIndex is actually present
    if (typeof e?.stepIndex === "number" && e.stepIndex >= 0) {
      failsByStep.set(e.stepIndex, (failsByStep.get(e.stepIndex) ?? 0) + 1);
    }

    // Fix 2: use actual sessionLog field names
    if (
      typeof e?.playedMidi === "number" &&
      e.playedMidi !== 0 &&
      e?.rating !== "miss"
    ) {
      wrongByMidi.set(e.playedMidi, (wrongByMidi.get(e.playedMidi) ?? 0) + 1);
    }

    if (e?.rating === "miss" && Array.isArray(e?.expectedMidis)) {
      for (const m of e.expectedMidis) {
        missedByMidi.set(m, (missedByMidi.get(m) ?? 0) + 1);
      }
    } else if (!correct && Array.isArray(e?.expectedMidis)) {
      for (const m of e.expectedMidis) {
        if (m !== e?.playedMidi) {
          missedByMidi.set(m, (missedByMidi.get(m) ?? 0) + 1);
        }
      }
    }
  }

  // Fix 1: use unique step count, fall back to sessionLog.length if no stepIndex present
  const attempts = uniqueSteps.size > 0 ? uniqueSteps.size : sessionLog.length;

  // For flowing mode, compute accuracy the same way the UI display does:
  // flowingCorrect / (flowingCorrect + flowingMissed + flowingExtra)
  // This accounts for extra/wrong notes the student played, matching the on-screen %.
  if (mode === "flowing") {
    const flowingCorrect = sessionLog.filter(
      (e: any) => e.rating && e.rating !== "miss" && e.correct,
    ).length;
    const flowingMissed = sessionLog.filter(
      (e: any) => e.rating === "miss",
    ).length;
    const flowingExtra = sessionLog.filter(
      (e: any) => e.rating === undefined && !e.correct,
    ).length;
    const flowingEvaluated = flowingCorrect + flowingMissed + flowingExtra;
    const accuracyPct =
      flowingEvaluated > 0
        ? Math.round((flowingCorrect / flowingEvaluated) * 100)
        : 100;

    const topN = (m: Map<number, number>) =>
      [...m.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([midi, count]) => ({ midi, note: midiToNoteName(midi), count }));

    const hasStepInfo = uniqueSteps.size > 0;
    const hotspots = hasStepInfo
      ? [...failsByStep.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([step, fails]) => ({ step, fails }))
      : [];

    return {
      pieceTitle,
      mode,
      totalSteps,
      attempts,
      hits: flowingCorrect,
      wrongs: flowingMissed + flowingExtra,
      accuracyPct,
      topWrong: topN(wrongByMidi),
      topMissed: topN(missedByMidi),
      hotspots,
      playbackSpeed,
    };
  }

  const accuracyDenominator = attempts;
  const accuracyPct =
    accuracyDenominator > 0
      ? Math.round((hits / accuracyDenominator) * 100)
      : 0;

  const topN = (m: Map<number, number>) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([midi, count]) => ({ midi, note: midiToNoteName(midi), count }));

  // Fix 3: only include hotspots if step data was actually present
  const hasStepInfo = uniqueSteps.size > 0;
  const hotspots = hasStepInfo
    ? [...failsByStep.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([step, fails]) => ({ step, fails }))
    : [];

  return {
    pieceTitle,
    mode,
    totalSteps,
    attempts,
    hits,
    wrongs,
    accuracyPct,
    topWrong: topN(wrongByMidi),
    topMissed: topN(missedByMidi),
    hotspots,
    playbackSpeed,
  };
}

// ── Component ─────────────────────────────────────────────────────────

const SPEED_PRESETS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2] as const;

export function PracticeTab({
  state,
  controls,
  refs,
  isFullscreen = false,
  pianoSwitcher,
  playbackSpeed = 1,
  onExitFullscreen,
  setPlaybackSpeed,
  originalBpm,
  pianoOptions,
  pianoKey,
  setPianoKey,
  toggleFullscreen,
}: PracticeTabProps) {
  const { loadState, duration, pianoLoading } = state;
  const { formatTime, getAllNotes, stopPlayback, togglePlayback, seekTo } =
    controls;
  const { midiRef, pianoRef } = refs;

  const [settingsOpen, setSettingsOpen] = useState(false);

  const layoutInfoRef = useRef<{
    W: number;
    hitY: number;
    lo: number;
    hi: number;
    whiteCount: number;
  } | null>(null);

  const {
    state: practiceState,
    controls: practiceControls,
    stepsRef,
    practiceTimeRef,
    judgmentsRef,
    flowingAllNotesRef,
    flowingMatchedRef,
  } = usePracticeMode(
    midiRef,
    pianoRef,
    getAllNotes,
    layoutInfoRef,
    playbackSpeed,
  );

  const {
    status,
    practiceMode,
    practiceTime,
    currentStepIndex,
    totalSteps,
    expectedMidis,
    satisfiedMidis,
    wrongNote,
    midiDevices,
    activeDevice,
    sessionLog,
    isComplete,
    error,
    heldNotes,
    showSkipButton,
    flowingTotalNotes,
  } = practiceState;

  const {
    start,
    reset,
    skipStep,
    setActiveDevice,
    setPracticeMode,
    togglePause,
  } = practiceControls;

  // ── AI Feedback state (added; does not affect practice logic) ───────
  const [feedbackText, setFeedbackText] = useState<string | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);

  // ── Canvas refs ─────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number>(0);
  const notesCache = useRef<NoteEvent[]>([]);

  // ── Bass track detection (same as FallingNotesTab) ──────────────
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

  // ── Layout computation ──────────────────────────────────────────
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

  const expectedMidisRef = useRef(expectedMidis);
  useEffect(() => {
    expectedMidisRef.current = expectedMidis;
  }, [expectedMidis]);

  const satisfiedMidisRef = useRef(satisfiedMidis);
  useEffect(() => {
    satisfiedMidisRef.current = satisfiedMidis;
  }, [satisfiedMidis]);

  const wrongNoteRef = useRef(wrongNote);
  useEffect(() => {
    wrongNoteRef.current = wrongNote;
  }, [wrongNote]);

  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const heldNotesRef = useRef(heldNotes);
  useEffect(() => {
    heldNotesRef.current = heldNotes;
  }, [heldNotes]);

  const practiceModeRef = useRef(practiceMode);
  useEffect(() => {
    practiceModeRef.current = practiceMode;
  }, [practiceMode]);

  // ── Resize observer ─────────────────────────────────────────────
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

  // ── Stop regular playback when practice starts ──────────────────
  const handleStart = useCallback(async () => {
    if (midiDevices.length === 0) return;
    stopPlayback();
    start();

    // In flowing mode, start MIDI audio playback so the user can hear
    // the reference piece while they play along.
    if (practiceMode === "flowing") {
      await togglePlayback();
      const allNotes = getAllNotes();
      if (allNotes.length > 0) {
        const sorted = [...allNotes].sort((a, b) => a.time - b.time);
        const startOffset = Math.max(0, sorted[0].time - 2);
        seekTo(startOffset);
      }
    }

    // Feedback UI reset (does not affect practice logic)
    setFeedbackText(null);
    setFeedbackError(null);
    setShowFeedback(false);
  }, [
    stopPlayback,
    start,
    practiceMode,
    togglePlayback,
    getAllNotes,
    seekTo,
    midiDevices.length,
  ]);

  // ── Stop audio when resetting ───────────────────────────────────
  const handleReset = useCallback(() => {
    reset();
    stopPlayback();
  }, [reset, stopPlayback]);

  // ── AI Feedback (added; does not affect practice logic) ──────────
  const getFeedback = useCallback(async () => {
    if (sessionLog.length === 0) return;

    setFeedbackLoading(true);
    setFeedbackError(null);

    try {
      const summary = buildPracticeSummary({
        sessionLog,
        totalSteps: practiceMode === "flowing" ? flowingTotalNotes : totalSteps,
        flowingTotalNotes,
        pieceTitle: state.title || "this piece",
        mode: practiceMode,
        playbackSpeed,
      });
      const res = await fetch("/api/piano-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary }),
      });

      if (!res.ok) throw new Error(`API error ${res.status}`);

      const data: { text?: string } = await res.json();
      const text = (data.text ?? "").trim();
      setFeedbackText(text || "No feedback returned.");
      setShowFeedback(true);
    } catch (e: unknown) {
      setFeedbackError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setFeedbackLoading(false);
    }
  }, [
    sessionLog,
    totalSteps,
    flowingTotalNotes,
    practiceMode,
    state.title,
    playbackSpeed,
  ]);

  // ── Render loop ─────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;

    const kbHeight = H * KEYBOARD_HEIGHT_RATIO;
    const playAreaHeight = H - kbHeight;
    const hitY = playAreaHeight;

    layoutInfoRef.current = {
      W,
      hitY,
      lo: layout.lo,
      hi: layout.hi,
      whiteCount: layout.whiteCount,
    };

    // Use practice clock instead of Tone.Transport
    const currentTime = practiceTimeRef.current;
    const curExpected = expectedMidisRef.current;
    const curSatisfied = satisfiedMidisRef.current;
    const curWrongNote = wrongNoteRef.current;
    const curStatus = statusRef.current;
    const curHeld = heldNotesRef.current;
    const curMode = practiceModeRef.current;
    const isFlowing = curMode === "flowing";

    // Clear
    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(0, 0, W, H);

    const { lo, hi, whiteCount } = layout;
    const whiteKeyWidth = W / whiteCount;
    const pxPerSec = playAreaHeight / LOOK_AHEAD;

    // ── Draw falling note bars ────────────────────────────────────
    const notes = notesCache.current;
    const activeKeys = new Set<number>();

    for (const note of notes) {
      const noteEnd = note.time + note.duration;

      const yBottom = hitY - (note.time - currentTime) * pxPerSec;
      const yTop = hitY - (noteEnd - currentTime) * pxPerSec;
      if (yBottom < 0 || yTop > H) continue;

      const barHeight = Math.max(MIN_BAR_PX, yBottom - yTop);

      if (currentTime >= note.time && currentTime < noteEnd) {
        activeKeys.add(note.midi);
      }

      const pos = keyPosition(note.midi, lo, hi, whiteCount, W);
      const barX = pos.x + 1;
      const barW = pos.w - 2;
      const radius = Math.min(4, barW / 2, barHeight / 2);
      const isBass = bassTrack >= 0 ? note.track === bassTrack : note.midi < 60;

      // Determine note color — highlight expected notes at the hit line (not in flowing mode)
      let fillAlpha = 0.85;
      let isExpectedNote = false;
      if (
        !isFlowing &&
        curExpected.has(note.midi) &&
        Math.abs(note.time - currentTime) < 0.05
      ) {
        isExpectedNote = true;
        fillAlpha = 1;
      }

      ctx.fillStyle = noteColor(isBass, fillAlpha);
      ctx.beginPath();
      ctx.roundRect(barX, yTop, barW, barHeight, radius);
      ctx.fill();

      // Glow for active/expected notes
      if (activeKeys.has(note.midi) || isExpectedNote) {
        ctx.shadowColor = isExpectedNote
          ? EXPECTED_KEY_COLOR
          : ACTIVE_KEY_COLOR;
        ctx.shadowBlur = isExpectedNote ? 16 : 12;
        ctx.fillStyle = noteColor(isBass, 1);
        ctx.beginPath();
        ctx.roundRect(barX, yTop, barW, barHeight, radius);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Label
      if (barHeight > 14 && barW > 18) {
        const label = midiToNoteName(note.midi);
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.font = `bold ${Math.min(11, barW * 0.45)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, pos.centre, yTop + barHeight / 2, barW - 4);
      }
    }

    // ── Hit line ──────────────────────────────────────────────────
    const hitLineColor =
      !isFlowing && curStatus === "waiting"
        ? "rgba(239,68,68,0.6)"
        : HIT_LINE_COLOR;
    ctx.fillStyle = hitLineColor;
    ctx.fillRect(0, hitY - 1, W, 2);

    // ── Draw piano keyboard ───────────────────────────────────────

    // White keys
    let wi = 0;
    for (let m = lo; m <= hi; m++) {
      if (isBlackKey(m)) continue;
      const x = wi * whiteKeyWidth;

      // Determine key colour
      let keyColor = WHITE_KEY_COLOR;
      if (isFlowing) {
        // Flowing mode: just show held notes, no expected/wrong colouring
        if (curHeld.has(m)) {
          keyColor = ACTIVE_KEY_COLOR;
        } else if (activeKeys.has(m)) {
          keyColor = "#FFD6E8"; // faint pink for notes at hit line
        }
      } else {
        if (curWrongNote === m) {
          keyColor = WRONG_KEY_COLOR;
        } else if (curExpected.has(m) && !curSatisfied.has(m)) {
          keyColor = EXPECTED_KEY_COLOR;
        } else if (curSatisfied.has(m)) {
          keyColor = ACTIVE_KEY_COLOR;
        } else if (curHeld.has(m)) {
          keyColor = "#FFB3D9"; // light pink for held but not expected
        } else if (activeKeys.has(m)) {
          keyColor = ACTIVE_KEY_COLOR;
        }
      }

      ctx.fillStyle = keyColor;
      ctx.fillRect(x, hitY, whiteKeyWidth, kbHeight);

      ctx.strokeStyle = KEY_BORDER_COLOR;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, hitY, whiteKeyWidth, kbHeight);

      if (whiteKeyWidth > 14) {
        const label = midiToNoteName(m);
        const isHighlighted = keyColor !== WHITE_KEY_COLOR;
        ctx.fillStyle = isHighlighted
          ? "rgba(255,255,255,0.9)"
          : "rgba(100,100,120,0.5)";
        ctx.font = `${Math.min(10, whiteKeyWidth * 0.35)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(
          label,
          x + whiteKeyWidth / 2,
          hitY + kbHeight - 4,
          whiteKeyWidth - 2,
        );
      }
      wi++;
    }

    // Black keys
    for (let m = lo; m <= hi; m++) {
      if (!isBlackKey(m)) continue;
      const pos = keyPosition(m, lo, hi, whiteCount, W);
      const bkHeight = kbHeight * BLACK_KEY_HEIGHT_RATIO;

      let keyColor = BLACK_KEY_COLOR;
      if (isFlowing) {
        if (curHeld.has(m)) {
          keyColor = ACTIVE_KEY_COLOR;
        } else if (activeKeys.has(m)) {
          keyColor = "#CC5C8A";
        }
      } else {
        if (curWrongNote === m) {
          keyColor = WRONG_KEY_COLOR;
        } else if (curExpected.has(m) && !curSatisfied.has(m)) {
          keyColor = EXPECTED_KEY_COLOR;
        } else if (curSatisfied.has(m)) {
          keyColor = ACTIVE_KEY_COLOR;
        } else if (curHeld.has(m)) {
          keyColor = "#CC5C8A";
        } else if (activeKeys.has(m)) {
          keyColor = ACTIVE_KEY_COLOR;
        }
      }

      ctx.fillStyle = keyColor;
      ctx.beginPath();
      ctx.roundRect(pos.x, hitY, pos.w, bkHeight, [0, 0, 3, 3]);
      ctx.fill();

      if (pos.w > 14) {
        const label = midiToNoteName(m);
        const isHighlighted = keyColor !== BLACK_KEY_COLOR;
        ctx.fillStyle = isHighlighted
          ? "rgba(255,255,255,0.95)"
          : "rgba(200,200,220,0.6)";
        ctx.font = `${Math.min(9, pos.w * 0.38)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(label, pos.centre, hitY + bkHeight - 3, pos.w - 2);
      }
    }

    // ── Flowing mode: judgment popups ─────────────────────────────
    if (isFlowing && judgmentsRef.current.length > 0) {
      const now = performance.now();
      const activeJudgments: FlowingJudgment[] = [];

      for (const j of judgmentsRef.current) {
        const age = now - j.createdAt;
        if (age > JUDGMENT_DURATION_MS) continue;
        activeJudgments.push(j);

        const progress = age / JUDGMENT_DURATION_MS;
        const alpha = 1 - progress;
        const floatOffset = progress * JUDGMENT_FLOAT_PX;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = j.color;
        ctx.font = "bold 16px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";

        // Draw text shadow for readability
        ctx.shadowColor = "rgba(0,0,0,0.5)";
        ctx.shadowBlur = 4;
        ctx.fillText(j.text, j.x, j.y - floatOffset);
        ctx.shadowBlur = 0;
        ctx.restore();
      }

      // Prune expired judgments
      judgmentsRef.current = activeJudgments;
    }

    // ── Status overlay ────────────────────────────────────────────
    if (!isFlowing && curStatus === "waiting") {
      ctx.fillStyle = "rgba(239, 68, 68, 0.12)";
      ctx.fillRect(0, 0, W, playAreaHeight);

      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = "bold 14px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Play the highlighted notes ↓", W / 2, 30);
    }

    if (curStatus === "idle") {
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.font = "bold 16px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Press Start to begin practicing", W / 2, H / 2);
    }

    if (curStatus === "paused") {
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "bold 20px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("⏸ Paused", W / 2, H / 2 - 12);

      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = "14px system-ui, sans-serif";
      ctx.fillText("Press Resume to continue", W / 2, H / 2 + 16);
    }

    if (curStatus === "complete") {
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = "#4ADE80";
      ctx.font = "bold 20px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("✓ Piece Complete!", W / 2, H / 2 - 12);

      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = "14px system-ui, sans-serif";
      ctx.fillText("Get AI Feedback or Reset to try again", W / 2, H / 2 + 16);
    }

    // ── Time overlay ──────────────────────────────────────────────
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`${formatTime(currentTime)} / ${formatTime(duration)}`, 8, 8);
  }, [layout, bassTrack, duration, formatTime, practiceTimeRef]);

  // ── Animation frame loop ────────────────────────────────────────
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

  if (loadState !== "ready") return null;

  // ── Compute stats ───────────────────────────────────────────────
  const isFlowingMode = practiceMode === "flowing";

  // Flowing mode stats
  const flowingCorrect = sessionLog.filter(
    (e) => e.rating && e.rating !== "miss" && e.correct,
  ).length;
  const flowingMissed = sessionLog.filter((e) => e.rating === "miss").length;
  const flowingExtra = sessionLog.filter(
    (e) => e.rating === undefined && !e.correct,
  ).length;
  const flowingEvaluated = flowingCorrect + flowingMissed + flowingExtra;
  const flowingAccuracy =
    flowingEvaluated > 0
      ? Math.round((flowingCorrect / flowingEvaluated) * 100)
      : 100;
  const ratingCounts = { perfect: 0, great: 0, okay: 0, poor: 0 };
  for (const e of sessionLog) {
    if (e.rating && e.rating !== "miss" && e.rating in ratingCounts) {
      ratingCounts[e.rating as keyof typeof ratingCounts]++;
    }
  }

  // Discrete/continuous mode stats
  const progressPct =
    totalSteps > 0 ? Math.round((currentStepIndex / totalSteps) * 100) : 0;
  const correctCount = sessionLog.filter((e) => e.correct).length;
  const wrongCount = sessionLog.filter((e) => !e.correct).length;
  const accuracy =
    sessionLog.length > 0
      ? Math.round((correctCount / sessionLog.length) * 100)
      : 100;

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

    // Practice Mode
    items.push({
      id: "mode",
      label: "Practice Mode",
      currentValue:
        practiceMode.charAt(0).toUpperCase() + practiceMode.slice(1),
      panel: (
        <div>
          {(["flowing", "continuous", "discrete"] as const).map((mode) => (
            <SettingsRadioItem
              key={mode}
              label={mode.charAt(0).toUpperCase() + mode.slice(1)}
              description={
                mode === "flowing"
                  ? "Play along in real-time"
                  : mode === "continuous"
                    ? "Waits for each note, auto-advances"
                    : "Step through one chord at a time"
              }
              selected={practiceMode === mode}
              onClick={() => setPracticeMode(mode)}
            />
          ))}
        </div>
      ),
    });

    // MIDI Device
    if (midiDevices.length > 0) {
      const activeName =
        midiDevices.find((d) => d.id === activeDevice)?.name ?? "None";
      items.push({
        id: "midi-device",
        label: "MIDI Device",
        currentValue: activeName,
        panel: (
          <div>
            {midiDevices.map((d) => (
              <SettingsRadioItem
                key={d.id}
                label={d.name ?? d.id}
                selected={activeDevice === d.id}
                onClick={() => setActiveDevice(d.id)}
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
    practiceMode,
    setPracticeMode,
    midiDevices,
    activeDevice,
    setActiveDevice,
  ]);

  // ── Accuracy badge (shared between fullscreen and normal) ──────────
  const accuracyBadge = (() => {
    if (isFlowingMode && sessionLog.length > 0) {
      return (
        <span
          className={`text-xs font-medium rounded-full px-2 py-0.5 border ${
            flowingAccuracy >= 80
              ? "text-green-400 bg-green-400/10 border-green-400/30"
              : flowingAccuracy >= 50
                ? "text-amber-400 bg-amber-400/10 border-amber-400/30"
                : "text-red-400 bg-red-400/10 border-red-400/30"
          }`}
        >
          {flowingAccuracy}%
        </span>
      );
    }
    if (!isFlowingMode && sessionLog.length > 0) {
      return (
        <span
          className={`text-xs font-medium rounded-full px-2 py-0.5 border ${
            accuracy >= 80
              ? "text-green-400 bg-green-400/10 border-green-400/30"
              : accuracy >= 50
                ? "text-amber-400 bg-amber-400/10 border-amber-400/30"
                : "text-red-400 bg-red-400/10 border-red-400/30"
          }`}
        >
          {accuracy}% · {correctCount}✓ {wrongCount}✗
        </span>
      );
    }
    return null;
  })();

  // ── Fullscreen layout ───────────────────────────────────────────────
  if (isFullscreen) {
    const keepOverlayVisible =
      status === "idle" ||
      status === "paused" ||
      status === "complete" ||
      settingsOpen;

    const canvasEl = (
      <div ref={containerRef} className="w-full h-full relative">
        <canvas ref={canvasRef} className="block w-full h-full" />
        {/* Piano loading overlay */}
        {pianoLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
            <div className="flex items-center gap-2 text-white/80 text-sm">
              <Loader2 className="w-5 h-5 animate-spin text-pink-400" />
              <span>Loading piano…</span>
            </div>
          </div>
        )}
        {/* Start overlay */}
        {status === "idle" && !pianoLoading && (
          <button
            onClick={handleStart}
            disabled={midiDevices.length === 0}
            className={`absolute inset-0 flex items-center justify-center bg-black/20 transition-colors group ${
              midiDevices.length === 0
                ? "cursor-not-allowed"
                : "hover:bg-black/30"
            }`}
            aria-label="Start Practice"
          >
            <div
              className={`w-16 h-16 rounded-full flex items-center justify-center shadow-xl transition-colors ${
                midiDevices.length === 0
                  ? "bg-gray-400/90"
                  : "bg-green-400/90 group-hover:bg-green-500"
              }`}
            >
              <Play className="w-7 h-7 text-white ml-1" />
            </div>
            {midiDevices.length === 0 && (
              <div className="absolute mt-24 text-white font-medium bg-black/50 px-4 py-2 rounded-full">
                Please connect a MIDI device to start
              </div>
            )}
          </button>
        )}
      </div>
    );

    return (
      <div className="absolute inset-0">
        <FullscreenOverlay
          keepVisible={keepOverlayVisible}
          canvasContent={canvasEl}
        >
          {/* Controls row */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Start / Pause / Reset */}
            {status === "idle" ? (
              <button
                onClick={handleStart}
                disabled={midiDevices.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-500 hover:bg-green-600 text-white text-xs font-medium transition disabled:opacity-40"
              >
                <Play className="w-3.5 h-3.5" />
                Start
              </button>
            ) : (
              <>
                {(status === "flowing" || status === "paused") && (
                  <button
                    onClick={() => {
                      togglePause();
                      togglePlayback();
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium transition"
                  >
                    {status === "paused" ? (
                      <Play className="w-3.5 h-3.5" />
                    ) : (
                      <Pause className="w-3.5 h-3.5" />
                    )}
                    {status === "paused" ? "Resume" : "Pause"}
                  </button>
                )}
                <button
                  onClick={handleReset}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/20 text-white/80 hover:bg-white/10 text-xs font-medium transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset
                </button>
              </>
            )}

            {/* Skip */}
            {!isFlowingMode &&
              showSkipButton &&
              status !== "idle" &&
              status !== "complete" && (
                <button
                  onClick={skipStep}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-400 hover:bg-amber-500 text-white text-xs font-medium transition"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                  Skip
                </button>
              )}

            {/* Accuracy */}
            {accuracyBadge}

            {/* Progress (discrete/continuous) */}
            {!isFlowingMode && status !== "idle" && (
              <span className="text-xs text-white/50 tabular-nums">
                {Math.min(currentStepIndex + 1, totalSteps)}/{totalSteps}
              </span>
            )}

            {/* Time */}
            <span className="text-xs text-white/60 tabular-nums">
              {formatTime(practiceTime)} / {formatTime(duration)}
            </span>

            {/* AI Feedback */}
            {sessionLog.length > 0 && (
              <button
                onClick={getFeedback}
                disabled={feedbackLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-pink-400 hover:bg-pink-500 text-white text-xs font-medium transition disabled:opacity-60"
              >
                {feedbackLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                AI Feedback
              </button>
            )}

            {/* Spacer */}
            <div className="flex-1" />

            {/* No MIDI device warning */}
            {midiDevices.length === 0 && (
              <span className="text-xs text-red-400">No MIDI device</span>
            )}

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

          {/* Error */}
          {error && (
            <div className="mt-2 p-2 rounded-lg bg-red-500/20 border border-red-400/30 text-red-300 text-xs text-center">
              ⚠ {error}
            </div>
          )}
        </FullscreenOverlay>
      </div>
    );
  }

  // ── Normal (non-fullscreen) layout ──────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-2xl border border-pink-200/40"
        style={{ height: "min(60vh, 520px)" }}
      >
        <canvas ref={canvasRef} className="block w-full h-full" />

        {/* Piano loading overlay */}
        {pianoLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-10 rounded-2xl">
            <div className="flex items-center gap-2 text-white/90 text-sm">
              <Loader2 className="w-5 h-5 animate-spin text-pink-400" />
              <span>Switching piano…</span>
            </div>
          </div>
        )}

        {/* Start overlay */}
        {status === "idle" && !pianoLoading && (
          <button
            onClick={handleStart}
            disabled={midiDevices.length === 0}
            className={`absolute inset-0 flex items-center justify-center bg-black/20 transition-colors group ${
              midiDevices.length === 0
                ? "cursor-not-allowed"
                : "hover:bg-black/30"
            }`}
            aria-label="Start Practice"
          >
            <div
              className={`w-16 h-16 rounded-full flex items-center justify-center shadow-xl transition-colors ${
                midiDevices.length === 0
                  ? "bg-gray-400/90"
                  : "bg-green-400/90 group-hover:bg-green-500"
              }`}
            >
              <Play className="w-7 h-7 text-white ml-1" />
            </div>
            {midiDevices.length === 0 && (
              <div className="absolute mt-24 text-white font-medium bg-black/50 px-4 py-2 rounded-full">
                Please connect a MIDI device to start
              </div>
            )}
          </button>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-center gap-3 shrink-0">
        {/* Start / Reset */}
        {status === "idle" ? (
          <button
            onClick={handleStart}
            disabled={midiDevices.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-green-500 hover:bg-green-600 text-white text-sm font-medium transition disabled:opacity-40"
          >
            <Play className="w-4 h-4" />
            Start
          </button>
        ) : (
          <>
            {(status === "flowing" || status === "paused") && (
              <button
                onClick={() => {
                  togglePause();
                  togglePlayback();
                }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium transition"
              >
                {status === "paused" ? (
                  <Play className="w-4 h-4" />
                ) : (
                  <Pause className="w-4 h-4" />
                )}
                {status === "paused" ? "Resume" : "Pause"}
              </button>
            )}
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white border border-pink-200 text-pink-500 hover:bg-pink-50 text-sm font-medium transition"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
          </>
        )}

        {/* MIDI device selector */}
        {midiDevices.length > 0 ? (
          <select
            className="border border-pink-100 rounded-full px-3 py-2 text-xs text-[#2D3142] bg-white outline-none focus:border-pink-300 max-w-[180px]"
            value={activeDevice ?? ""}
            onChange={(e) => setActiveDevice(e.target.value)}
          >
            {midiDevices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-red-400">No MIDI device</span>
        )}

        {/* Skip step (escape hatch) — not shown in flowing mode */}
        {!isFlowingMode &&
          showSkipButton &&
          status !== "idle" &&
          status !== "complete" && (
            <button
              onClick={skipStep}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-400 hover:bg-amber-500 text-white text-xs font-medium transition animate-in fade-in duration-300"
            >
              <SkipForward className="w-3.5 h-3.5" />
              Skip
            </button>
          )}

        {/* Mode toggle: Flowing / Continuous / Discrete */}
        <div className="flex rounded-full border border-pink-200 bg-white overflow-hidden text-xs font-medium">
          <button
            onClick={() => setPracticeMode("flowing")}
            className={`px-3 py-1.5 transition ${
              practiceMode === "flowing"
                ? "bg-pink-400 text-white"
                : "text-pink-400 hover:bg-pink-50"
            }`}
          >
            Flowing
          </button>
          <button
            onClick={() => setPracticeMode("continuous")}
            className={`px-3 py-1.5 transition ${
              practiceMode === "continuous"
                ? "bg-pink-400 text-white"
                : "text-pink-400 hover:bg-pink-50"
            }`}
          >
            Continuous
          </button>
          <button
            onClick={() => setPracticeMode("discrete")}
            className={`px-3 py-1.5 transition ${
              practiceMode === "discrete"
                ? "bg-pink-400 text-white"
                : "text-pink-400 hover:bg-pink-50"
            }`}
          >
            Discrete
          </button>
        </div>

        {/* Progress — discrete/continuous */}
        {!isFlowingMode && status !== "idle" && (
          <span className="text-xs text-slate-400 tabular-nums">
            Step {Math.min(currentStepIndex + 1, totalSteps)}/{totalSteps} (
            {progressPct}%)
          </span>
        )}

        {/* Accuracy badge — depends on mode */}
        {isFlowingMode && sessionLog.length > 0 && (
          <span
            className={`text-xs font-medium rounded-full px-3 py-1 border ${
              flowingAccuracy >= 80
                ? "text-green-600 bg-green-50 border-green-200"
                : flowingAccuracy >= 50
                  ? "text-amber-600 bg-amber-50 border-amber-200"
                  : "text-red-500 bg-red-50 border-red-200"
            }`}
          >
            {flowingAccuracy}% · {ratingCounts.perfect}P {ratingCounts.great}G{" "}
            {ratingCounts.okay}O {ratingCounts.poor}B {flowingMissed}M
          </span>
        )}

        {!isFlowingMode && sessionLog.length > 0 && (
          <span
            className={`text-xs font-medium rounded-full px-3 py-1 border ${
              accuracy >= 80
                ? "text-green-600 bg-green-50 border-green-200"
                : accuracy >= 50
                  ? "text-amber-600 bg-amber-50 border-amber-200"
                  : "text-red-500 bg-red-50 border-red-200"
            }`}
          >
            {accuracy}% · {correctCount}✓ {wrongCount}✗
          </span>
        )}

        {/* AI Feedback button */}
        {sessionLog.length > 0 &&
          process.env.NEXT_PUBLIC_IS_AI_FEEDBACK_ENABLED === "true" && (
            <button
              onClick={getFeedback}
              disabled={feedbackLoading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-pink-400 hover:bg-pink-500 text-white text-sm font-medium transition disabled:opacity-60"
            >
              {feedbackLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              AI Feedback
            </button>
          )}

        {/* Time display */}
        <span className="text-xs text-slate-400 tabular-nums min-w-[4rem] text-right">
          {formatTime(practiceTime)} / {formatTime(duration)}
        </span>

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

      {/* Error */}
      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-red-500 text-sm text-center">
          ⚠ {error}
        </div>
      )}

      {/* AI Feedback panel */}
      {(feedbackText || feedbackError) && (
        <div className="rounded-2xl border border-pink-100 bg-pink-50/60 overflow-hidden">
          <button
            onClick={() => setShowFeedback((prev) => !prev)}
            className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-pink-600 hover:bg-pink-50 transition"
          >
            <span className="flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              AI Feedback
            </span>
            {showFeedback ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>

          {showFeedback && (
            <div className="px-5 pb-4">
              {feedbackError ? (
                <p className="text-red-500 text-sm">⚠ {feedbackError}</p>
              ) : (
                <div className="text-[#2D3142]/80 text-sm leading-relaxed prose prose-sm max-w-none">
                  <ReactMarkdown>{feedbackText ?? ""}</ReactMarkdown>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
