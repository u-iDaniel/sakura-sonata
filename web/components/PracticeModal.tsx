"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Midi } from "@tonejs/midi";
import { X } from "lucide-react";
import ReactMarkdown from "react-markdown";

// ── Types ─────────────────────────────────────────────────────────────────────

type Score = {
  id: string;
  title: string | null;
  file_path: string | null;
};

type CapturedNote = {
  midi: number;
  velocity: number;
  time: number;
  offsetMs: number;
  duration: number;
};

type ReferenceNote = {
  midi: number;
  note: string;
  timeMs: number;
  durationMs: number;
  velocity: number;
};

type Comparison = {
  missingNotes: string[];
  extraNotes: string[];
  timingErrors: { note: string; diffMs: number; direction: string }[];
  accuracy: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];
function midiNoteToName(midi: number) {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function extractReferenceNotes(midi: Midi): ReferenceNote[] {
  const notes: ReferenceNote[] = [];
  for (const track of midi.tracks) {
    for (const note of track.notes) {
      notes.push({
        midi: note.midi,
        note: midiNoteToName(note.midi),
        timeMs: Math.round(note.time * 1000),
        durationMs: Math.round(note.duration * 1000),
        velocity: Math.round(note.velocity * 127),
      });
    }
  }
  return notes.sort((a, b) => a.timeMs - b.timeMs);
}

function comparePerformance(
  played: CapturedNote[],
  reference: ReferenceNote[],
): Comparison {
  const refByMidi: Record<number, ReferenceNote[]> = {};
  for (const n of reference) {
    if (!refByMidi[n.midi]) refByMidi[n.midi] = [];
    refByMidi[n.midi].push(n);
  }
  const playedByMidi: Record<number, CapturedNote[]> = {};
  for (const n of played) {
    if (!playedByMidi[n.midi]) playedByMidi[n.midi] = [];
    playedByMidi[n.midi].push(n);
  }

  const refMidis = new Set(reference.map((n) => n.midi));
  const playedMidis = new Set(played.map((n) => n.midi));

  const missingNotes = [...refMidis]
    .filter((m) => !playedMidis.has(m))
    .map(midiNoteToName);
  const extraNotes = [...playedMidis]
    .filter((m) => !refMidis.has(m))
    .map(midiNoteToName);

  const refStartMs = reference[0]?.timeMs ?? 0;
  const playedStartMs = played[0]?.offsetMs ?? 0;
  const timingErrors: Comparison["timingErrors"] = [];

  for (const midi of [...refMidis].filter((m) => playedMidis.has(m))) {
    const count = Math.min(refByMidi[midi].length, playedByMidi[midi].length);
    for (let i = 0; i < count; i++) {
      const diffMs =
        playedByMidi[midi][i].offsetMs -
        playedStartMs -
        (refByMidi[midi][i].timeMs - refStartMs);
      if (Math.abs(diffMs) > 150)
        timingErrors.push({
          note: midiNoteToName(midi),
          diffMs,
          direction: diffMs > 0 ? "late" : "early",
        });
    }
  }

  const accuracy = Math.round(
    (reference.filter((n) => playedMidis.has(n.midi)).length /
      reference.length) *
      100,
  );
  return { missingNotes, extraNotes, timingErrors, accuracy };
}

function buildPrompt(
  played: CapturedNote[],
  reference: ReferenceNote[],
  comparison: Comparison,
  title: string,
) {
  const { missingNotes, extraNotes, timingErrors, accuracy } = comparison;
  return `You are an encouraging but precise piano coach. A student just finished playing "${title}".

Performance accuracy: ${accuracy}% of reference notes played correctly.
Notes missing: ${missingNotes.length ? missingNotes.join(", ") : "none"}
Extra notes: ${extraNotes.length ? extraNotes.join(", ") : "none"}
Timing errors (>150ms): ${timingErrors.length ? timingErrors.map((e) => `${e.note} ${Math.abs(e.diffMs)}ms ${e.direction}`).join(", ") : "none"}
Average velocity: ${Math.round(played.reduce((s, n) => s + n.velocity, 0) / played.length)}/127
Notes played: ${played.length} (score has ${reference.length})

Give feedback in 3 short paragraphs: (1) note accuracy, (2) timing & rhythm, (3) one thing to focus on next. Be warm but precise.`;
}

// ── Component ─────────────────────────────────────────────────────────────────

type Status =
  | "loading_midi"
  | "ready"
  | "recording"
  | "done_recording"
  | "fetching"
  | "done"
  | "error";

export default function PracticeModal({
  score,
  onClose,
}: {
  score: Score;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<Status>("loading_midi");
  const [referenceNotes, setReferenceNotes] = useState<ReferenceNote[] | null>(
    null,
  );
  const [midiDevices, setMidiDevices] = useState<
    { id: string; name: string; ref: MIDIInput }[]
  >([]);
  const [activeDevice, setActiveDevice] = useState<string | null>(null);
  const [recordedCount, setRecordedCount] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);

  const noteOnMap = useRef<Record<number, { time: number; velocity: number }>>(
    {},
  );
  const capturedEvents = useRef<CapturedNote[]>([]);
  const isRecording = useRef(false);

  // Load MIDI from Supabase storage URL
  useEffect(() => {
    if (!score.file_path) {
      setError("No file URL for this score.");
      setStatus("error");
      return;
    }

    fetch(score.file_path)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to fetch MIDI: ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buffer) => {
        const midi = new Midi(buffer);
        setReferenceNotes(extractReferenceNotes(midi));
        setStatus("ready");
      })
      .catch((e) => {
        setError(e.message);
        setStatus("error");
      });
  }, [score.file_path]);

  // MIDI device setup
  useEffect(() => {
    if (!navigator.requestMIDIAccess) {
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
      if (access)
        for (const i of access.inputs.values()) i.onmidimessage = null;
    };
  }, []);

  function refreshDevices(access: MIDIAccess) {
    const devices = Array.from(access.inputs.values()).map((i) => ({
      id: i.id,
      name: i.name ?? "Unknown Device",
      ref: i as MIDIInput,
    }));
    setMidiDevices(devices);
    if (devices.length > 0) setActiveDevice((prev) => prev ?? devices[0].id);
  }

  // Attach MIDI listener
  useEffect(() => {
    if (!activeDevice || !midiDevices.length) return;
    midiDevices.forEach((d) => {
      d.ref.onmidimessage = null;
    });
    const device = midiDevices.find((d) => d.id === activeDevice);
    if (!device) return;
    device.ref.onmidimessage = (msg: MIDIMessageEvent) => {
      if (!isRecording.current) return;
      const [s, midi, velocity] = msg.data!;
      const type = s & 0xf0;
      if (type === 0x90 && velocity > 0) {
        noteOnMap.current[midi] = { time: performance.now(), velocity };
      } else if (type === 0x80 || (type === 0x90 && velocity === 0)) {
        const on = noteOnMap.current[midi];
        if (on) {
          const startTime = capturedEvents.current[0]?.time ?? on.time;
          capturedEvents.current.push({
            midi,
            velocity: on.velocity,
            time: on.time,
            offsetMs: Math.round(on.time - startTime),
            duration: performance.now() - on.time,
          });
          setRecordedCount((c) => c + 1);
          delete noteOnMap.current[midi];
        }
      }
    };
  }, [activeDevice, midiDevices]);

  const startRecording = useCallback(() => {
    capturedEvents.current = [];
    noteOnMap.current = {};
    isRecording.current = true;
    setRecordedCount(0);
    setFeedback(null);
    setComparison(null);
    setError(null);
    setStatus("recording");
  }, []);

  const stopRecording = useCallback(() => {
    isRecording.current = false;
    setStatus(capturedEvents.current.length > 0 ? "done_recording" : "ready");
  }, []);

  const getFeedback = useCallback(async () => {
    if (!capturedEvents.current.length || !referenceNotes) return;
    const comp = comparePerformance(capturedEvents.current, referenceNotes);
    setComparison(comp);
    setStatus("fetching");
    try {
      const res = await fetch("/api/piano-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: buildPrompt(
            capturedEvents.current,
            referenceNotes,
            comp,
            score.title ?? "this piece",
          ),
        }),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      setFeedback((data.text ?? "").trim() || "No feedback returned.");
      setStatus("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setStatus("error");
    }
  }, [referenceNotes, score.title]);

  const reset = () => {
    capturedEvents.current = [];
    noteOnMap.current = {};
    isRecording.current = false;
    setRecordedCount(0);
    setFeedback(null);
    setComparison(null);
    setError(null);
    setStatus("ready");
  };

  const accuracyColor = comparison
    ? comparison.accuracy >= 80
      ? "#16a34a"
      : comparison.accuracy >= 50
        ? "#d97706"
        : "#dc2626"
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div
        className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg p-8 max-h-[90vh] overflow-y-auto"
        style={{ boxShadow: "0 8px 48px rgba(217, 108, 142, 0.18)" }}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full hover:bg-pink-50 text-sakura-text-pink/60 hover:text-sakura-text-pink transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <h2 className="text-2xl font-bold text-sakura-text-pink mb-1">
          Practice Mode
        </h2>
        <p className="text-sakura-dark/50 text-sm mb-6">
          {score.title ?? "Untitled"}
        </p>

        {/* Loading MIDI */}
        {status === "loading_midi" && (
          <div className="text-sakura-dark/50 text-sm">Loading score…</div>
        )}

        {/* Ready+ states */}
        {status !== "loading_midi" && status !== "error" && (
          <>
            {/* MIDI device */}
            <div className="mb-5">
              <label className="block text-xs font-medium text-sakura-dark/40 uppercase tracking-wider mb-1.5">
                MIDI Device
              </label>
              {midiDevices.length === 0 ? (
                <p className="text-sm text-red-400">
                  No MIDI keyboard detected. Connect one and refresh.
                </p>
              ) : (
                <select
                  className="w-full border border-pink-100 rounded-xl px-3 py-2 text-sm text-sakura-dark bg-pink-50/30 outline-none focus:border-sakura-text-pink/40"
                  value={activeDevice ?? ""}
                  onChange={(e) => setActiveDevice(e.target.value)}
                  disabled={status === "recording"}
                >
                  {midiDevices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Score info */}
            {referenceNotes && (
              <div className="mb-5 flex items-center gap-2">
                <span className="text-xs text-green-600 bg-green-50 border border-green-100 rounded-full px-3 py-1">
                  ✓ {referenceNotes.length} notes loaded
                </span>
              </div>
            )}

            {/* Recording controls */}
            <div className="flex items-center justify-between bg-pink-50/50 rounded-2xl px-5 py-4 mb-5">
              <div className="flex items-center gap-3">
                <div
                  className={`w-2.5 h-2.5 rounded-full ${status === "recording" ? "bg-red-500 animate-pulse" : "bg-pink-200"}`}
                />
                <span className="text-sm text-sakura-dark/70">
                  {status === "recording"
                    ? `Recording… (${recordedCount} notes)`
                    : status === "done_recording" ||
                        status === "done" ||
                        status === "fetching"
                      ? `${recordedCount} notes captured`
                      : "Ready to record"}
                </span>
              </div>
              <div className="flex gap-2">
                {status === "ready" && (
                  <button
                    onClick={startRecording}
                    disabled={midiDevices.length === 0}
                    className="px-4 py-1.5 rounded-full bg-sakura-text-pink text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-40"
                  >
                    ● Record
                  </button>
                )}
                {status === "recording" && (
                  <button
                    onClick={stopRecording}
                    className="px-4 py-1.5 rounded-full bg-red-100 text-red-500 border border-red-200 text-sm font-medium hover:bg-red-200 transition"
                  >
                    ■ Stop
                  </button>
                )}
                {(status === "done_recording" || status === "done") && (
                  <button
                    onClick={reset}
                    className="px-4 py-1.5 rounded-full border border-pink-200 text-sakura-text-pink/70 text-sm hover:bg-pink-50 transition"
                  >
                    ↺ New
                  </button>
                )}
              </div>
            </div>

            {/* Accuracy badge */}
            {comparison && (
              <div className="mb-4">
                <span
                  className="text-sm font-semibold rounded-full px-4 py-1.5 border"
                  style={{
                    color: accuracyColor!,
                    background: `${accuracyColor}11`,
                    borderColor: `${accuracyColor}33`,
                  }}
                >
                  {comparison.accuracy}% accuracy
                </span>
              </div>
            )}

            {/* Get feedback button */}
            {status === "done_recording" && (
              <button
                onClick={getFeedback}
                className="w-full py-3 rounded-2xl bg-sakura-text-pink text-white font-semibold text-sm hover:opacity-90 transition"
              >
                Get AI Feedback →
              </button>
            )}

            {status === "fetching" && (
              <div className="w-full py-3 rounded-2xl bg-pink-50 text-sakura-text-pink/60 text-sm text-center">
                Analysing with Claude…
              </div>
            )}

            {/* Feedback */}
            {feedback && (
              <div className="mt-5 p-5 rounded-2xl bg-pink-50/60 border border-pink-100 text-sakura-dark/80 text-sm leading-relaxed prose prose-sm max-w-none">
                <ReactMarkdown>{feedback}</ReactMarkdown>
              </div>
            )}
          </>
        )}

        {/* Error */}
        {error && (
          <div className="mt-4 p-4 rounded-xl bg-red-50 border border-red-100 text-red-500 text-sm">
            ⚠ {error}
          </div>
        )}
      </div>
    </div>
  );
}
