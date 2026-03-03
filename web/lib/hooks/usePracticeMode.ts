"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Midi } from "@tonejs/midi";
import * as Tone from "tone";
import type { PianoPlayer } from "@/lib/piano";
import type { NoteEvent } from "@/lib/hooks/useMidiPlayer";
import { ensureAudioContext } from "@/lib/piano/audio-context";
import type {
  PracticeLogEntry,
  FlowingJudgment,
  FlowingRating,
} from "@/lib/piano/midi-helpers";
import {
  JUDGMENT_PERFECT_COLOR,
  JUDGMENT_GREAT_COLOR,
  JUDGMENT_OKAY_COLOR,
  JUDGMENT_POOR_COLOR,
} from "@/lib/piano/canvas-utils";

// ── Types ─────────────────────────────────────────────────────────────

/** A "step" groups simultaneous notes (chords) that the user must play. */
export interface PracticeStep {
  /** Index of this step in the sequence */
  index: number;
  /** Time in the MIDI file (seconds) when these notes start */
  time: number;
  /** Set of MIDI note numbers expected at this step */
  midis: Set<number>;
  /** All MIDI notes that must be held at this step (own midis + sustained from prior steps) */
  requiredMidis: Set<number>;
  /** Full note events (for audio playback) */
  notes: NoteEvent[];
  /** Longest note duration in this step (seconds) */
  maxDuration: number;
}

export type PracticeStatus =
  | "idle" // waiting for user to click Start
  | "playing" // waiting for user to press the correct notes
  | "sustaining" // user holding correct notes, clock advancing in real-time (continuous only)
  | "waiting" // wrong note pressed or released, waiting for correct input
  | "flowing" // flowing mode: clock advancing in real-time automatically
  | "paused" // flowing mode: paused
  | "complete"; // reached the end of the piece

export type PracticeMode = "discrete" | "continuous" | "flowing";

export interface PracticeModeState {
  status: PracticeStatus;
  /** Current practice mode */
  practiceMode: PracticeMode;
  /** Current position in the piece (seconds) — drives falling notes canvas */
  practiceTime: number;
  /** Current step index the user is on */
  currentStepIndex: number;
  /** Total number of steps */
  totalSteps: number;
  /** MIDI numbers the user needs to press right now */
  expectedMidis: Set<number>;
  /** MIDI numbers the user has correctly pressed in the current step so far */
  satisfiedMidis: Set<number>;
  /** Last wrong note the user pressed (null if no error) */
  wrongNote: number | null;
  /** Connected MIDI input devices */
  midiDevices: { id: string; name: string; ref: MIDIInput }[];
  /** Currently selected device id */
  activeDevice: string | null;
  /** Session log for AI feedback */
  sessionLog: PracticeLogEntry[];
  /** Whether the piece is fully completed */
  isComplete: boolean;
  /** Error message */
  error: string | null;
  /** MIDI notes currently being held down by the user */
  heldNotes: Set<number>;
  /** Whether the skip button should be visible (after 3s stuck on a step) */
  showSkipButton: boolean;
  /** Total reference note count (for flowing mode accuracy) */
  flowingTotalNotes: number;
}

export interface PracticeModeControls {
  start: () => Promise<void>;
  reset: () => void;
  skipStep: () => void;
  setActiveDevice: (id: string) => void;
  setPracticeMode: (mode: PracticeMode) => void;
  togglePause: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────

const CHORD_TOLERANCE_SEC = 0.03; // 30ms — notes within this window = same step
/** If user holds a note for longer than its duration × this factor, reset step */
const OVER_HOLD_FACTOR = 1.5;
/** Minimum effective note duration for the over-hold check (seconds) */
const MIN_EFFECTIVE_DURATION = 0.3;

// Flowing mode timing thresholds (ms)
const FLOWING_PERFECT_MS = 50;
const FLOWING_GREAT_MS = 150;
const FLOWING_OKAY_MS = 300;
const FLOWING_MATCH_WINDOW_MS = 500;

// ── Step builder ──────────────────────────────────────────────────────

function buildSteps(allNotes: NoteEvent[]): PracticeStep[] {
  if (allNotes.length === 0) return [];

  const sorted = [...allNotes].sort(
    (a, b) => a.time - b.time || a.midi - b.midi,
  );

  const steps: PracticeStep[] = [];
  let currentGroup: NoteEvent[] = [sorted[0]];
  let groupTime = sorted[0].time;

  for (let i = 1; i < sorted.length; i++) {
    const note = sorted[i];
    if (note.time - groupTime <= CHORD_TOLERANCE_SEC) {
      currentGroup.push(note);
    } else {
      steps.push({
        index: steps.length,
        time: groupTime,
        midis: new Set(currentGroup.map((n) => n.midi)),
        requiredMidis: new Set(), // placeholder — filled in second pass
        notes: currentGroup,
        maxDuration: Math.max(...currentGroup.map((n) => n.duration)),
      });
      currentGroup = [note];
      groupTime = note.time;
    }
  }
  steps.push({
    index: steps.length,
    time: groupTime,
    midis: new Set(currentGroup.map((n) => n.midi)),
    requiredMidis: new Set(), // placeholder — filled in second pass
    notes: currentGroup,
    maxDuration: Math.max(...currentGroup.map((n) => n.duration)),
  });

  // Second pass: compute requiredMidis for each step.
  // A step's requiredMidis = its own midis PLUS any notes from earlier steps
  // whose duration extends past this step's start time (i.e. still sounding).
  for (const step of steps) {
    const required = new Set(step.midis);
    for (const note of sorted) {
      // Only consider notes that started strictly before this step
      if (note.time >= step.time - CHORD_TOLERANCE_SEC) continue;
      // Note still sounding at this step's time
      if (note.time + note.duration > step.time + CHORD_TOLERANCE_SEC) {
        required.add(note.midi);
      }
    }
    step.requiredMidis = required;
  }

  return steps;
}

// ── Flowing-mode rating helper ────────────────────────────────────────

function rateTimingOffset(absMs: number): FlowingRating {
  if (absMs <= FLOWING_PERFECT_MS) return "perfect";
  if (absMs <= FLOWING_GREAT_MS) return "great";
  if (absMs <= FLOWING_OKAY_MS) return "okay";
  return "poor";
}

function ratingColor(rating: FlowingRating): string {
  switch (rating) {
    case "perfect":
      return JUDGMENT_PERFECT_COLOR;
    case "great":
      return JUDGMENT_GREAT_COLOR;
    case "okay":
      return JUDGMENT_OKAY_COLOR;
    case "poor":
      return JUDGMENT_POOR_COLOR;
    case "miss":
      return JUDGMENT_POOR_COLOR;
  }
}

function ratingText(rating: FlowingRating): string {
  switch (rating) {
    case "perfect":
      return "Perfect";
    case "great":
      return "Great";
    case "okay":
      return "Okay";
    case "poor":
      return "Poor";
    case "miss":
      return "Miss";
  }
}

// ── Hook ──────────────────────────────────────────────────────────────

export function usePracticeMode(
  midiRef: React.RefObject<Midi | null>,
  pianoRef: React.RefObject<PianoPlayer | null>,
  getAllNotes: () => NoteEvent[],
  layoutInfoRef?: React.RefObject<{
    W: number;
    hitY: number;
    lo: number;
    hi: number;
    whiteCount: number;
  } | null>,
  playbackSpeed: number = 1,
  ensurePianoReady?: () => Promise<PianoPlayer | null>,
) {
  // Keep a ref so animation callbacks always get the latest value
  const playbackSpeedRef = useRef(playbackSpeed);
  playbackSpeedRef.current = playbackSpeed;
  // ── React state (for UI rendering) ─────────────────────────────
  const [practiceMode, setPracticeModeState] =
    useState<PracticeMode>("flowing");
  const [status, setStatus] = useState<PracticeStatus>("idle");
  const [practiceTime, setPracticeTime] = useState(0);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [expectedMidis, setExpectedMidis] = useState<Set<number>>(new Set());
  const [satisfiedMidis, setSatisfiedMidis] = useState<Set<number>>(new Set());
  const [wrongNote, setWrongNote] = useState<number | null>(null);
  const [midiDevices, setMidiDevices] = useState<
    { id: string; name: string; ref: MIDIInput }[]
  >([]);
  const [activeDevice, setActiveDevice] = useState<string | null>(null);
  const [sessionLog, setSessionLog] = useState<PracticeLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [heldNotes, setHeldNotes] = useState<Set<number>>(new Set());
  const [showSkipButton, setShowSkipButton] = useState(false);
  const [flowingTotalNotes, setFlowingTotalNotes] = useState(0);

  // ── Refs (source of truth for async callbacks — avoids stale closures) ──
  const stepsRef = useRef<PracticeStep[]>([]);
  const stepIndexRef = useRef(0);
  const statusRef = useRef<PracticeStatus>("idle");
  const practiceModeRef = useRef<PracticeMode>("flowing");
  const satisfiedRef = useRef<Set<number>>(new Set());
  const sessionLogRef = useRef<PracticeLogEntry[]>([]);
  const sessionStartRef = useRef(0);
  const heldNotesRef = useRef<Set<number>>(new Set());
  /** Notes that must be released and re-pressed before they count as satisfied
   *  (same note appearing in consecutive steps — re-articulation). */
  const rearticNeededRef = useRef<Set<number>>(new Set());

  /** The real-time practice clock — updated per-frame during sustaining.
   *  The canvas reads from this ref directly for smooth animation. */
  const practiceTimeRef = useRef(0);

  // Sustain animation refs
  const sustainAnimRef = useRef<number>(0);
  const sustainBaseWallRef = useRef(0); // performance.now() when sustain started/resumed
  const sustainBasePracticeRef = useRef(0); // practiceTime when sustain started/resumed
  const audioPlayedRef = useRef(false); // has audio been played for the current step?
  const skipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Flowing mode refs ───────────────────────────────────────────
  const flowingAnimRef = useRef<number>(0);
  const flowingStartWallRef = useRef(0);
  const flowingStartOffsetRef = useRef(0);
  /** All individual NoteEvent references for flowing mode matching */
  const flowingAllNotesRef = useRef<NoteEvent[]>([]);
  /** Set of indices into flowingAllNotesRef that have been matched */
  const flowingMatchedRef = useRef<Set<number>>(new Set());
  /** Set of indices that have been logged as misses */
  const flowingMissedRef = useRef<Set<number>>(new Set());
  /** Active judgment popups — read directly by the canvas */
  const judgmentsRef = useRef<FlowingJudgment[]>([]);
  /** End time of the last note in the piece (for completion detection) */
  const flowingEndTimeRef = useRef(0);
  /** Set of note indices whose reference audio has already been triggered */
  const flowingPlayedRef = useRef<Set<number>>(new Set());

  // Keep refs in sync
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  useEffect(() => {
    practiceModeRef.current = practiceMode;
  }, [practiceMode]);

  // ── Re-anchor clocks when playback speed changes mid-practice ───
  // Without this, the elapsed-time formula (wallΔ × speed) would
  // retroactively apply the new speed to all elapsed wall-time,
  // causing the position to jump.
  const prevSpeedRef = useRef(playbackSpeed);
  useEffect(() => {
    if (playbackSpeed === prevSpeedRef.current) return;
    prevSpeedRef.current = playbackSpeed;

    const st = statusRef.current;

    // Re-anchor flowing clock
    if (st === "flowing") {
      flowingStartOffsetRef.current = practiceTimeRef.current;
      flowingStartWallRef.current = performance.now();
    }

    // Re-anchor sustain clock
    if (st === "sustaining") {
      sustainBasePracticeRef.current = practiceTimeRef.current;
      sustainBaseWallRef.current = performance.now();
    }
  }, [playbackSpeed]);

  const setPracticeMode = useCallback((mode: PracticeMode) => {
    if (mode === practiceModeRef.current) return;
    // Reset entire piece when switching modes so the user starts fresh
    cancelAnimationFrame(sustainAnimRef.current);
    cancelAnimationFrame(flowingAnimRef.current);
    stepsRef.current = [];
    stepIndexRef.current = 0;
    satisfiedRef.current = new Set();
    sessionLogRef.current = [];
    heldNotesRef.current = new Set();
    rearticNeededRef.current = new Set();
    audioPlayedRef.current = false;
    flowingAllNotesRef.current = [];
    flowingMatchedRef.current = new Set();
    flowingMissedRef.current = new Set();
    flowingPlayedRef.current = new Set();
    judgmentsRef.current = [];
    setFlowingTotalNotes(0);
    practiceTimeRef.current = 0;
    setPracticeTime(0);
    setCurrentStepIndex(0);
    setExpectedMidis(new Set());
    setSatisfiedMidis(new Set());
    setWrongNote(null);
    setSessionLog([]);
    setError(null);
    setHeldNotes(new Set());
    setShowSkipButton(false);
    resetSkipTimer();
    setStatus("idle");
    statusRef.current = "idle";

    setPracticeModeState(mode);
    practiceModeRef.current = mode;
  }, []);

  // ── Build steps when MIDI data is available ─────────────────────
  const buildAllSteps = useCallback(() => {
    const notes = getAllNotes();
    if (notes.length === 0) return [];
    return buildSteps(notes);
  }, [getAllNotes]);

  // ── MIDI device setup ───────────────────────────────────────────
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.requestMIDIAccess) {
      setError("Web MIDI API not supported in this browser.");
      return;
    }

    let access: MIDIAccess;
    navigator
      .requestMIDIAccess()
      .then((a) => {
        access = a;
        refreshDevices(a);
        a.onstatechange = () => refreshDevices(a);
      })
      .catch(() => setError("MIDI access denied."));

    return () => {
      if (access) {
        for (const i of access.inputs.values()) i.onmidimessage = null;
      }
    };
  }, []);

  function refreshDevices(access: MIDIAccess) {
    const devices = Array.from(access.inputs.values()).map((i) => ({
      id: i.id,
      name: i.name ?? "Unknown Device",
      ref: i as MIDIInput,
    }));
    setMidiDevices(devices);
    if (devices.length > 0) {
      setActiveDevice((prev) => prev ?? devices[0].id);
    }
  }

  // ── Play step audio (inline helper) ─────────────────────────────
  function playStepAudioInline(step: PracticeStep) {
    const piano = pianoRef.current;
    if (!piano) return;
    // AudioContext is already unlocked from the start() user gesture —
    // no need to call Tone.start() here.
    for (const note of step.notes) {
      piano.start({
        note: note.name,
        duration: note.duration,
        velocity: note.velocity,
      });
    }
  }

  // ── Core sustain / navigation functions ─────────────────────────
  // Defined as plain functions that read exclusively from refs, so they
  // always get current values. Stored in refs so async callbacks (MIDI
  // handler, requestAnimationFrame) can call the latest version.

  const startSustainLoopRef = useRef<() => void>(() => {});
  const startFlowingLoopRef = useRef<() => void>(() => {});
  const goToStepRef = useRef<(idx: number) => void>(() => {});
  const checkAndResumeRef = useRef<() => void>(() => {});

  /** Reset the 3-second skip-button timer (called whenever the step changes or sustaining starts) */
  function resetSkipTimer() {
    if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
    setShowSkipButton(false);
  }

  /** Start the 3-second skip-button timer (called when entering playing/waiting state) */
  function startSkipTimer() {
    resetSkipTimer();
    skipTimerRef.current = setTimeout(() => {
      // Only show if still stuck (not sustaining or complete)
      const st = statusRef.current;
      if (st === "playing" || st === "waiting") {
        setShowSkipButton(true);
      }
    }, 3000);
  }

  /**
   * Start the real-time sustain animation loop.
   * Advances practiceTimeRef each frame while status === "sustaining".
   * Detects: next step boundary, over-hold reset, and piece completion.
   */
  function startSustainLoop() {
    cancelAnimationFrame(sustainAnimRef.current);
    let lastStateUpdate = performance.now();

    function tick() {
      if (statusRef.current !== "sustaining") return;

      const now = performance.now();
      const elapsed =
        ((now - sustainBaseWallRef.current) * playbackSpeedRef.current) / 1000;
      const newTime = sustainBasePracticeRef.current + elapsed;

      const currentSteps = stepsRef.current;
      const idx = stepIndexRef.current;
      if (idx >= currentSteps.length) return;

      const step = currentSteps[idx];
      const effectiveDuration = Math.max(
        MIN_EFFECTIVE_DURATION,
        step.maxDuration,
      );
      const nextIdx = idx + 1;

      // ── Next step check (priority — must fire before over-hold) ───
      if (nextIdx < currentSteps.length) {
        if (newTime >= currentSteps[nextIdx].time) {
          cancelAnimationFrame(sustainAnimRef.current);
          goToStepRef.current(nextIdx);
          return;
        }
      } else {
        // Last step — complete when note duration is finished
        if (newTime >= step.time + effectiveDuration) {
          cancelAnimationFrame(sustainAnimRef.current);
          practiceTimeRef.current = newTime;
          setPracticeTime(newTime);
          setStatus("complete");
          statusRef.current = "complete";
          setCurrentStepIndex(nextIdx);
          return;
        }
      }

      // ── Over-hold check: held too long → reset to step beginning ──
      // Use the gap to the next step as a floor so we never reset before
      // the clock could naturally reach the next step boundary.
      const gapToNext =
        nextIdx < currentSteps.length
          ? currentSteps[nextIdx].time - step.time
          : effectiveDuration;
      const overHoldLimit =
        step.time + Math.max(effectiveDuration, gapToNext) * OVER_HOLD_FACTOR;

      if (newTime >= overHoldLimit) {
        cancelAnimationFrame(sustainAnimRef.current);
        practiceTimeRef.current = step.time;
        setPracticeTime(step.time);
        satisfiedRef.current = new Set();
        setSatisfiedMidis(new Set());
        audioPlayedRef.current = false;
        setStatus("playing");
        statusRef.current = "playing";
        setWrongNote(null);
        return;
      }

      // ── Normal tick — advance time ────────────────────────────────
      practiceTimeRef.current = newTime;

      // Throttled React state update (100ms) for the UI time display
      if (now - lastStateUpdate > 100) {
        setPracticeTime(newTime);
        lastStateUpdate = now;
      }

      sustainAnimRef.current = requestAnimationFrame(tick);
    }

    sustainAnimRef.current = requestAnimationFrame(tick);
  }

  /**
   * Move to a specific step index. If the new step's expected notes
   * are already held, auto-continue sustaining (handles sustained passages).
   */
  function goToStep(idx: number) {
    cancelAnimationFrame(sustainAnimRef.current);
    const currentSteps = stepsRef.current;

    stepIndexRef.current = idx;
    setCurrentStepIndex(idx);

    if (idx >= currentSteps.length) {
      setStatus("complete");
      statusRef.current = "complete";
      return;
    }

    const step = currentSteps[idx];
    const isContinuous = practiceModeRef.current === "continuous";
    const required = isContinuous ? step.requiredMidis : step.midis;
    practiceTimeRef.current = step.time;
    setPracticeTime(step.time);
    setExpectedMidis(new Set(required));
    satisfiedRef.current = new Set();
    setSatisfiedMidis(new Set());
    setWrongNote(null);
    audioPlayedRef.current = false;

    // Detect re-articulation: notes that start fresh at this step but were also
    // starting notes in the previous step. The user must lift and re-press them.
    const reartic = new Set<number>();
    if (isContinuous && idx > 0) {
      const prevStep = currentSteps[idx - 1];
      for (const m of step.midis) {
        if (prevStep.midis.has(m)) {
          reartic.add(m);
        }
      }
    }
    rearticNeededRef.current = reartic;

    // Auto-continue if all expected notes are already held (continuous mode only)
    // Notes needing re-articulation don't count as held yet.
    const held = heldNotesRef.current;
    const allHeld = [...required].every((m) => held.has(m) && !reartic.has(m));

    if (isContinuous && allHeld) {
      resetSkipTimer();
      satisfiedRef.current = new Set(required);
      setSatisfiedMidis(new Set(required));
      playStepAudioInline(step);
      audioPlayedRef.current = true;
      sustainBaseWallRef.current = performance.now();
      sustainBasePracticeRef.current = step.time;
      setStatus("sustaining");
      statusRef.current = "sustaining";
      startSustainLoopRef.current();
    } else {
      setStatus("playing");
      statusRef.current = "playing";
      startSkipTimer();
    }
  }

  /**
   * Check if we can start/resume sustaining: all expected notes must be held.
   * Called after note-on of a correct note, or after a wrong note is released.
   */
  function checkAndResume() {
    const st = statusRef.current;
    if (st !== "waiting" && st !== "playing") return;

    const idx = stepIndexRef.current;
    const currentSteps = stepsRef.current;
    if (idx >= currentSteps.length) return;

    const step = currentSteps[idx];
    const isContinuous = practiceModeRef.current === "continuous";
    const required = isContinuous ? step.requiredMidis : step.midis;
    const held = heldNotesRef.current;
    const reartic = rearticNeededRef.current;

    // All expected notes must be held, and re-articulation notes must have been re-pressed
    if (![...required].every((m) => held.has(m) && !reartic.has(m))) return;

    satisfiedRef.current = new Set(required);
    setSatisfiedMidis(new Set(required));

    // Play audio only on first entry to this step
    if (!audioPlayedRef.current) {
      playStepAudioInline(step);
      audioPlayedRef.current = true;
    }

    if (practiceModeRef.current === "discrete") {
      // Discrete: instantly advance to the next step
      setWrongNote(null);
      const nextIdx = idx + 1;
      goToStepRef.current(nextIdx);
      return;
    }

    // Continuous: start the real-time sustain clock
    resetSkipTimer();
    sustainBaseWallRef.current = performance.now();
    sustainBasePracticeRef.current = practiceTimeRef.current;
    setWrongNote(null);
    setStatus("sustaining");
    statusRef.current = "sustaining";
    startSustainLoopRef.current();
  }

  // Keep function refs current (updated every render)
  startSustainLoopRef.current = startSustainLoop;
  startFlowingLoopRef.current = startFlowingLoop;
  goToStepRef.current = goToStep;
  checkAndResumeRef.current = checkAndResume;

  // ── Flowing mode: real-time clock loop ──────────────────────────
  function startFlowingLoop() {
    cancelAnimationFrame(flowingAnimRef.current);
    let lastStateUpdate = performance.now();

    function tick() {
      if (statusRef.current !== "flowing") return;

      const now = performance.now();
      const elapsed =
        ((now - flowingStartWallRef.current) * playbackSpeedRef.current) / 1000;
      const newTime = flowingStartOffsetRef.current + elapsed;

      practiceTimeRef.current = newTime;

      // ── Play reference audio for notes the clock just passed ────
      const piano = pianoRef.current;
      const played = flowingPlayedRef.current;
      if (piano) {
        const allNotesAudio = flowingAllNotesRef.current;
        for (let i = 0; i < allNotesAudio.length; i++) {
          if (played.has(i)) continue;
          const note = allNotesAudio[i];
          if (note.time <= newTime) {
            played.add(i);
            piano.start({
              note: note.name,
              duration: note.duration,
              velocity: note.velocity,
            });
          }
          // Notes are sorted by time — stop once we reach future notes
          if (note.time > newTime) break;
        }
      }

      // ── Detect missed notes ─────────────────────────────────────
      const allNotes = flowingAllNotesRef.current;
      const matched = flowingMatchedRef.current;
      const missed = flowingMissedRef.current;
      const missDeadline = newTime - FLOWING_MATCH_WINDOW_MS / 1000;

      for (let i = 0; i < allNotes.length; i++) {
        if (matched.has(i) || missed.has(i)) continue;
        if (allNotes[i].time < missDeadline) {
          // This note was not played in time — log as miss
          missed.add(i);
          const note = allNotes[i];
          const logEntry: PracticeLogEntry = {
            stepIndex: i,
            expectedMidis: [note.midi],
            playedMidi: 0,
            correct: false,
            timestamp: performance.now() - sessionStartRef.current,
            timingOffsetMs: undefined,
            rating: "miss",
          };
          sessionLogRef.current = [...sessionLogRef.current, logEntry];
          setSessionLog([...sessionLogRef.current]);
        }
        // Notes are sorted by time; once we reach notes still in the future, stop
        if (allNotes[i].time > newTime) break;
      }

      // ── Completion check ────────────────────────────────────────
      if (newTime >= flowingEndTimeRef.current + 1.0) {
        cancelAnimationFrame(flowingAnimRef.current);
        // Log any remaining unmatched notes as misses
        for (let i = 0; i < allNotes.length; i++) {
          if (!matched.has(i) && !missed.has(i)) {
            missed.add(i);
            const note = allNotes[i];
            const logEntry: PracticeLogEntry = {
              stepIndex: i,
              expectedMidis: [note.midi],
              playedMidi: 0,
              correct: false,
              timestamp: performance.now() - sessionStartRef.current,
              timingOffsetMs: undefined,
              rating: "miss",
            };
            sessionLogRef.current = [...sessionLogRef.current, logEntry];
          }
        }
        setSessionLog([...sessionLogRef.current]);
        setStatus("complete");
        statusRef.current = "complete";
        setPracticeTime(newTime);
        return;
      }

      // Throttled React state update
      if (now - lastStateUpdate > 100) {
        setPracticeTime(newTime);
        lastStateUpdate = now;
      }

      flowingAnimRef.current = requestAnimationFrame(tick);
    }

    flowingAnimRef.current = requestAnimationFrame(tick);
  }

  /**
   * Handle a note-on in flowing mode: find the closest unmatched reference
   * note with the same MIDI pitch within the timing window and rate it.
   */
  function handleFlowingNoteOn(midi: number) {
    const currentTime = practiceTimeRef.current;
    const allNotes = flowingAllNotesRef.current;
    const matched = flowingMatchedRef.current;
    const missed = flowingMissedRef.current;

    // Find closest unmatched reference note with matching pitch within the window
    let bestIdx = -1;
    let bestAbsOffset = Infinity;

    for (let i = 0; i < allNotes.length; i++) {
      if (matched.has(i) || missed.has(i)) continue;
      const note = allNotes[i];
      if (note.midi !== midi) continue;
      const offsetMs = (currentTime - note.time) * 1000;
      const absOffset = Math.abs(offsetMs);
      if (absOffset <= FLOWING_MATCH_WINDOW_MS && absOffset < bestAbsOffset) {
        bestAbsOffset = absOffset;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      // Matched a reference note
      matched.add(bestIdx);
      const note = allNotes[bestIdx];
      const offsetMs = (currentTime - note.time) * 1000;
      const rating = rateTimingOffset(Math.abs(offsetMs));

      const logEntry: PracticeLogEntry = {
        stepIndex: bestIdx,
        expectedMidis: [note.midi],
        playedMidi: midi,
        correct: true,
        timestamp: performance.now() - sessionStartRef.current,
        timingOffsetMs: Math.round(offsetMs),
        rating,
      };
      sessionLogRef.current = [...sessionLogRef.current, logEntry];
      setSessionLog([...sessionLogRef.current]);

      // Create judgment popup
      const layout = layoutInfoRef?.current;
      if (layout) {
        const { W: canvasWidth, hitY, lo, hi, whiteCount } = layout;
        const whiteKeyWidth = canvasWidth / whiteCount;
        const blackKeyWidth = whiteKeyWidth * 0.6;
        let whiteIndex = 0;
        for (let m = lo; m < midi; m++) {
          if (!new Set([1, 3, 6, 8, 10]).has(m % 12)) whiteIndex++;
        }
        const isBlack = new Set([1, 3, 6, 8, 10]).has(midi % 12);
        const centreX = isBlack
          ? whiteIndex * whiteKeyWidth - blackKeyWidth / 2 + blackKeyWidth / 2
          : whiteIndex * whiteKeyWidth + whiteKeyWidth / 2;

        judgmentsRef.current = [
          ...judgmentsRef.current,
          {
            text: ratingText(rating),
            color: ratingColor(rating),
            x: centreX,
            y: hitY - 30,
            createdAt: performance.now(),
          },
        ];
      }
    } else {
      // Extra note — no matching reference note found
      const logEntry: PracticeLogEntry = {
        stepIndex: -1,
        expectedMidis: [],
        playedMidi: midi,
        correct: false,
        timestamp: performance.now() - sessionStartRef.current,
        timingOffsetMs: undefined,
        rating: undefined,
      };
      sessionLogRef.current = [...sessionLogRef.current, logEntry];
      setSessionLog([...sessionLogRef.current]);
    }
  }

  // ── Attach MIDI input listener ──────────────────────────────────
  useEffect(() => {
    if (!activeDevice || !midiDevices.length) return;

    // Clear previous listeners
    midiDevices.forEach((d) => {
      d.ref.onmidimessage = null;
    });

    const device = midiDevices.find((d) => d.id === activeDevice);
    if (!device) return;

    device.ref.onmidimessage = (msg: MIDIMessageEvent) => {
      const st = statusRef.current;

      // ── Flowing mode handler ──────────────────────────────────
      if (st === "flowing" || st === "paused") {
        const data = msg.data;
        if (!data || data.length < 3) return;
        const [s, midi, velocity] = data;
        const type = s & 0xf0;

        if (type === 0x90 && velocity > 0) {
          // Track held notes
          const newHeld = new Set(heldNotesRef.current);
          newHeld.add(midi);
          heldNotesRef.current = newHeld;
          setHeldNotes(new Set(newHeld));

          // Play the note sound — AudioContext was unlocked when practice started
          const piano = pianoRef.current;
          if (piano) {
            // Find matching note for duration/velocity or use defaults
            const allNotes = flowingAllNotesRef.current;
            const matched = flowingMatchedRef.current;
            const currentTime = practiceTimeRef.current;
            let matchedNote: NoteEvent | undefined;
            for (let i = 0; i < allNotes.length; i++) {
              if (matched.has(i)) continue;
              if (
                allNotes[i].midi === midi &&
                Math.abs(allNotes[i].time - currentTime) < 0.5
              ) {
                matchedNote = allNotes[i];
                break;
              }
            }
            piano.start({
              note:
                matchedNote?.name ||
                `${["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][midi % 12]}${Math.floor(midi / 12) - 1}`,
              duration: matchedNote?.duration || 0.5,
              velocity: velocity / 127,
            });
          }

          if (st === "flowing") {
            handleFlowingNoteOn(midi);
          }
        }

        if (type === 0x80 || (type === 0x90 && velocity === 0)) {
          const newHeld = new Set(heldNotesRef.current);
          newHeld.delete(midi);
          heldNotesRef.current = newHeld;
          setHeldNotes(new Set(newHeld));
        }
        return;
      }

      // ── Discrete / Continuous mode handler ────────────────────
      if (st !== "playing" && st !== "waiting" && st !== "sustaining") return;

      const data = msg.data;
      if (!data || data.length < 3) return;
      const [s, midi, velocity] = data;
      const type = s & 0xf0;

      // ── Note-on ─────────────────────────────────────────────────
      if (type === 0x90 && velocity > 0) {
        // Track held notes
        const newHeld = new Set(heldNotesRef.current);
        newHeld.add(midi);
        heldNotesRef.current = newHeld;
        setHeldNotes(new Set(newHeld));

        const currentSteps = stepsRef.current;
        const idx = stepIndexRef.current;
        if (idx >= currentSteps.length) return;

        const step = currentSteps[idx];
        const required =
          practiceModeRef.current === "continuous"
            ? step.requiredMidis
            : step.midis;

        // Log the key press
        const logEntry: PracticeLogEntry = {
          stepIndex: idx,
          expectedMidis: [...required],
          playedMidi: midi,
          correct: required.has(midi),
          timestamp: performance.now() - sessionStartRef.current,
        };
        sessionLogRef.current = [...sessionLogRef.current, logEntry];
        setSessionLog([...sessionLogRef.current]);

        if (required.has(midi)) {
          // ── Correct note ────────────────────────────────────────
          // Clear re-articulation flag for this note (user re-pressed it)
          if (rearticNeededRef.current.has(midi)) {
            const newReartic = new Set(rearticNeededRef.current);
            newReartic.delete(midi);
            rearticNeededRef.current = newReartic;
          }

          const newSatisfied = new Set(satisfiedRef.current);
          newSatisfied.add(midi);
          satisfiedRef.current = newSatisfied;
          setSatisfiedMidis(new Set(newSatisfied));
          setWrongNote(null);

          // Check if all notes satisfied → can start/resume sustaining
          checkAndResumeRef.current();
        } else {
          // ── Wrong note ──────────────────────────────────────────
          setWrongNote(midi);

          if (st === "sustaining") {
            // Pause the sustain loop, freeze practice time
            cancelAnimationFrame(sustainAnimRef.current);
            const frozenTime = practiceTimeRef.current;
            setPracticeTime(frozenTime);
          }

          setStatus("waiting");
          statusRef.current = "waiting";

          // Clear wrong-note highlight after 800ms, then try to auto-resume
          setTimeout(() => {
            setWrongNote((prev) => (prev === midi ? null : prev));
            // After clearing, check if all expected are still held → resume
            checkAndResumeRef.current();
          }, 800);
        }
      }

      // ── Note-off ────────────────────────────────────────────────
      if (type === 0x80 || (type === 0x90 && velocity === 0)) {
        const newHeld = new Set(heldNotesRef.current);
        newHeld.delete(midi);
        heldNotesRef.current = newHeld;
        setHeldNotes(new Set(newHeld));

        // Releasing a note that needs re-articulation is the first half of
        // the re-press gesture — keep it in rearticNeeded (cleared on note-on).

        const currentSteps = stepsRef.current;
        const idx = stepIndexRef.current;
        if (idx >= currentSteps.length) return;

        const step = currentSteps[idx];
        const required =
          practiceModeRef.current === "continuous"
            ? step.requiredMidis
            : step.midis;

        if (statusRef.current === "sustaining" && required.has(midi)) {
          // Required note released during sustain — pause clock
          cancelAnimationFrame(sustainAnimRef.current);
          const frozenTime = practiceTimeRef.current;
          setPracticeTime(frozenTime);

          const newSatisfied = new Set(satisfiedRef.current);
          newSatisfied.delete(midi);
          satisfiedRef.current = newSatisfied;
          setSatisfiedMidis(new Set(newSatisfied));

          setStatus("playing");
          statusRef.current = "playing";
        } else if (required.has(midi)) {
          // Correct note released while not sustaining
          const newSatisfied = new Set(satisfiedRef.current);
          newSatisfied.delete(midi);
          satisfiedRef.current = newSatisfied;
          setSatisfiedMidis(new Set(newSatisfied));
        }

        // If in waiting state and a note was released, try to resume
        if (statusRef.current === "waiting") {
          checkAndResumeRef.current();
        }
      }
    };

    return () => {
      device.ref.onmidimessage = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDevice, midiDevices]);

  // ── Skip step (escape hatch) ────────────────────────────────────
  const skipStep = useCallback(() => {
    const idx = stepIndexRef.current;
    const currentSteps = stepsRef.current;
    if (idx >= currentSteps.length) return;

    // Play the step audio so the user hears what it sounded like
    playStepAudioInline(currentSteps[idx]);

    resetSkipTimer();
    goToStepRef.current(idx + 1);
  }, []);

  // ── Toggle Pause (Flowing Mode) ─────────────────────────────────
  const togglePause = useCallback(() => {
    if (practiceModeRef.current !== "flowing") return;

    if (statusRef.current === "flowing") {
      cancelAnimationFrame(flowingAnimRef.current);
      setStatus("paused");
      statusRef.current = "paused";
    } else if (statusRef.current === "paused") {
      // Resume from where we left off
      flowingStartOffsetRef.current = practiceTimeRef.current;
      flowingStartWallRef.current = performance.now();
      setStatus("flowing");
      statusRef.current = "flowing";
      startFlowingLoopRef.current();
    }
  }, []);

  // ── Start practice ──────────────────────────────────────────────
  const start = useCallback(async () => {
    const allNotes = getAllNotes();
    if (allNotes.length === 0) {
      setError("No notes in this score.");
      return;
    }

    // Unlock AudioContext and ensure piano samples are loaded.
    // This runs inside a button click handler — a valid user gesture on iOS.
    await ensureAudioContext();
    if (ensurePianoReady) {
      const piano = await ensurePianoReady();
      if (!piano) return;
    }

    // Stop any Tone.Transport playback that may be running
    const transport = Tone.getTransport();
    transport.pause();

    cancelAnimationFrame(sustainAnimRef.current);
    cancelAnimationFrame(flowingAnimRef.current);

    sessionStartRef.current = performance.now();
    sessionLogRef.current = [];
    satisfiedRef.current = new Set();
    heldNotesRef.current = new Set();
    rearticNeededRef.current = new Set();
    audioPlayedRef.current = false;
    setSessionLog([]);
    setError(null);
    setHeldNotes(new Set());
    setShowSkipButton(false);
    setWrongNote(null);

    if (practiceModeRef.current === "flowing") {
      // ── Flowing mode start ────────────────────────────────────
      const sorted = [...allNotes].sort((a, b) => a.time - b.time);
      flowingAllNotesRef.current = sorted;
      flowingMatchedRef.current = new Set();
      flowingMissedRef.current = new Set();
      flowingPlayedRef.current = new Set();
      judgmentsRef.current = [];
      setFlowingTotalNotes(sorted.length);

      const firstNoteTime = sorted[0].time;
      // Start 2 seconds before first note so user can see notes coming
      const startOffset = Math.max(0, firstNoteTime - 2);
      const lastNote = sorted[sorted.length - 1];
      flowingEndTimeRef.current = lastNote.time + lastNote.duration;
      flowingStartOffsetRef.current = startOffset;
      flowingStartWallRef.current = performance.now();

      practiceTimeRef.current = startOffset;
      setPracticeTime(startOffset);
      setCurrentStepIndex(0);
      setExpectedMidis(new Set());
      setSatisfiedMidis(new Set());

      stepsRef.current = [];
      stepIndexRef.current = 0;

      setStatus("flowing");
      statusRef.current = "flowing";
      startFlowingLoop();
    } else {
      // ── Discrete / Continuous mode start ──────────────────────
      const allSteps = buildSteps(allNotes);
      if (allSteps.length === 0) {
        setError("No notes in this score.");
        return;
      }

      stepsRef.current = allSteps;
      stepIndexRef.current = 0;

      const firstStep = allSteps[0];
      practiceTimeRef.current = firstStep.time;
      setPracticeTime(firstStep.time);
      setCurrentStepIndex(0);
      setExpectedMidis(new Set(firstStep.midis));
      setSatisfiedMidis(new Set());
      setFlowingTotalNotes(0);

      setStatus("playing");
      statusRef.current = "playing";
      startSkipTimer();
    }
  }, [getAllNotes, ensurePianoReady]);

  // ── Reset ───────────────────────────────────────────────────────
  const reset = useCallback(() => {
    cancelAnimationFrame(sustainAnimRef.current);
    cancelAnimationFrame(flowingAnimRef.current);

    // Silence any currently ringing reference notes
    pianoRef.current?.stop();

    stepsRef.current = [];
    stepIndexRef.current = 0;
    satisfiedRef.current = new Set();
    sessionLogRef.current = [];
    heldNotesRef.current = new Set();
    rearticNeededRef.current = new Set();
    audioPlayedRef.current = false;

    flowingAllNotesRef.current = [];
    flowingMatchedRef.current = new Set();
    flowingMissedRef.current = new Set();
    flowingPlayedRef.current = new Set();
    judgmentsRef.current = [];
    setFlowingTotalNotes(0);

    practiceTimeRef.current = 0;
    setPracticeTime(0);
    setCurrentStepIndex(0);
    setExpectedMidis(new Set());
    setSatisfiedMidis(new Set());
    setWrongNote(null);
    setSessionLog([]);
    setError(null);
    setHeldNotes(new Set());
    setShowSkipButton(false);
    resetSkipTimer();
    setStatus("idle");
    statusRef.current = "idle";
  }, []);

  // ── Cleanup on unmount ──────────────────────────────────────────
  useEffect(() => {
    return () => {
      cancelAnimationFrame(sustainAnimRef.current);
      cancelAnimationFrame(flowingAnimRef.current);
      if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
    };
  }, []);

  // ── Handle browser tab visibility changes ───────────────────────
  // When the user switches to another browser tab or application,
  // requestAnimationFrame stops firing but wall-clock time keeps
  // advancing. Without this handler, returning to the tab would
  // cause all notes from the hidden interval to fire at once.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden) {
        // Tab became hidden — stop loops and silence notes
        const st = statusRef.current;
        if (st === "flowing") {
          cancelAnimationFrame(flowingAnimRef.current);
          pianoRef.current?.stop();
        }
        if (st === "sustaining") {
          cancelAnimationFrame(sustainAnimRef.current);
        }
      } else {
        // Tab became visible again — re-anchor clocks from current
        // position so elapsed hidden time is skipped, then restart.
        const st = statusRef.current;
        if (st === "flowing") {
          // Mark all notes up to current time as "played" so they
          // don't all fire at once on the next tick.
          const currentTime = practiceTimeRef.current;
          const allNotes = flowingAllNotesRef.current;
          const played = flowingPlayedRef.current;
          for (let i = 0; i < allNotes.length; i++) {
            if (played.has(i)) continue;
            if (allNotes[i].time <= currentTime) {
              played.add(i);
            }
            if (allNotes[i].time > currentTime) break;
          }

          flowingStartOffsetRef.current = currentTime;
          flowingStartWallRef.current = performance.now();
          startFlowingLoopRef.current();
        }
        if (st === "sustaining") {
          sustainBasePracticeRef.current = practiceTimeRef.current;
          sustainBaseWallRef.current = performance.now();
          startSustainLoopRef.current();
        }
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  return {
    state: {
      status,
      practiceMode,
      practiceTime,
      currentStepIndex,
      totalSteps: stepsRef.current.length,
      expectedMidis,
      satisfiedMidis,
      wrongNote,
      midiDevices,
      activeDevice,
      sessionLog,
      isComplete: status === "complete",
      error,
      heldNotes,
      showSkipButton,
      flowingTotalNotes,
    } satisfies PracticeModeState,
    controls: {
      start,
      reset,
      skipStep,
      setActiveDevice,
      setPracticeMode,
      togglePause,
    } satisfies PracticeModeControls,
    stepsRef,
    /** Real-time practice clock ref — read by the canvas draw loop for smooth animation */
    practiceTimeRef,
    /** Judgments ref — read by the canvas draw loop for flowing mode feedback popups */
    judgmentsRef,
    /** All notes ref for flowing mode */
    flowingAllNotesRef,
    /** Matched notes ref for flowing mode */
    flowingMatchedRef,
  };
}
