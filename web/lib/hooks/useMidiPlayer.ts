"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Midi } from "@tonejs/midi";
import * as Tone from "tone";
import type { PianoPlayer, PianoPlayerFactory } from "@/lib/piano";
import { splendidPiano } from "@/lib/piano";

/** Seconds of silence prepended so the user can prepare before notes begin. */
export const LEAD_IN_SEC = 1;

export type LoadState = "loading" | "ready" | "error";

export interface NoteEvent {
  time: number;
  duration: number;
  midi: number;
  name: string;
  velocity: number;
  track: number;
}

export interface MidiPlayerState {
  loadState: LoadState;
  error: string;
  title: string;
  isPlaying: boolean;
  progress: number;
  duration: number;
  bpm: number;
  noteCount: number;
  trackCount: number;
  activeNotes: string[];
  keySignature: string;
  timeSignature: string;
  playbackSpeed: number;
}

export interface MidiPlayerControls {
  togglePlayback: () => Promise<void>;
  stopPlayback: () => void;
  seekTo: (time: number) => void;
  skip: (seconds: number) => void;
  formatTime: (seconds: number) => string;
  getAllNotes: () => NoteEvent[];
  setPlaybackSpeed: (speed: number) => void;
}

export interface MidiPlayerRefs {
  midiRef: React.RefObject<Midi | null>;
  pianoRef: React.RefObject<PianoPlayer | null>;
}

export function useMidiPlayer(
  id: string | undefined,
  pianoFactory: PianoPlayerFactory = splendidPiano,
) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bpm, setBpm] = useState(120);
  const [noteCount, setNoteCount] = useState(0);
  const [trackCount, setTrackCount] = useState(0);
  const [activeNotes, setActiveNotes] = useState<string[]>([]);
  const [midiLoaded, setMidiLoaded] = useState(false);
  const [keySignature, setKeySignature] = useState("");
  const [timeSignature, setTimeSignature] = useState("");
  const [playbackSpeed, setPlaybackSpeedState] = useState(1);

  const pianoRef = useRef<PianoPlayer | null>(null);
  const disposedRef = useRef(false);
  const playbackSpeedRef = useRef(1);
  const durationRef = useRef(0);

  const partsRef = useRef<Tone.Part[]>([]);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const midiRef = useRef<Midi | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      stopPlayback();
      disposedRef.current = true;
      pianoRef.current?.dispose();
      partsRef.current.forEach((p) => p.dispose());
      Tone.getTransport().cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch score and MIDI file on mount
  useEffect(() => {
    if (!id) return;

    async function load() {
      try {
        const scoreRes = await fetch(`/api/music/score?id=${id}`);
        const data = await scoreRes.json();

        if (!scoreRes.ok) {
          data.error
            ? setError("Failed to load score: " + data.error)
            : setError("Failed to load score");
          setLoadState("error");
          return;
        }

        setTitle(data.title ?? "Untitled");

        const res = await fetch(data.file_path);
        if (!res.ok) {
          setError("Failed to download MIDI file.");
          setLoadState("error");
          return;
        }

        const arrayBuf = await res.arrayBuffer();
        const midi = new Midi(arrayBuf);
        midiRef.current = midi;

        const tempos = midi.header.tempos;
        if (tempos.length > 0) {
          setBpm(Math.round(tempos[0].bpm));
        }

        const keySigs = midi.header.keySignatures;
        if (keySigs.length > 0) {
          const k = keySigs[0];
          setKeySignature(`${k.key} ${k.scale}`);
        }

        const timeSigs = midi.header.timeSignatures;
        if (timeSigs.length > 0) {
          const t = timeSigs[0].timeSignature;
          setTimeSignature(`${t[0]}/${t[1]}`);
        }

        let totalNotes = 0;
        let maxEnd = 0;
        midi.tracks.forEach((track) => {
          totalNotes += track.notes.length;
          track.notes.forEach((n) => {
            const end = n.time + n.duration;
            if (end > maxEnd) maxEnd = end;
          });
        });

        setNoteCount(totalNotes);
        setTrackCount(midi.tracks.filter((t) => t.notes.length > 0).length);
        const dur = maxEnd + LEAD_IN_SEC;
        setDuration(dur);
        durationRef.current = dur;
        setMidiLoaded(true);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load tutorial.");
        setLoadState("error");
      }
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Create (or re-create) the piano player when the factory changes
  useEffect(() => {
    if (!midiLoaded) return;

    let cancelled = false;

    async function initPiano() {
      // Tear down any previous piano & playback
      stopPlayback();
      pianoRef.current?.dispose();
      pianoRef.current = null;
      setLoadState("loading");
      setError("");

      try {
        const audioContext = Tone.getContext().rawContext as AudioContext;
        const piano = pianoFactory(audioContext);
        await piano.loaded;

        if (cancelled) {
          piano.dispose();
          return;
        }

        pianoRef.current = piano;
        disposedRef.current = false;
        setLoadState("ready");
      } catch {
        if (!cancelled) {
          setError("Failed to load piano samples.");
          setLoadState("error");
        }
      }
    }

    initPiano();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [midiLoaded, pianoFactory]);

  const stopPlayback = useCallback(() => {
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel();
    transport.position = 0;
    partsRef.current.forEach((p) => p.dispose());
    partsRef.current = [];
    setIsPlaying(false);
    setProgress(0);
    setActiveNotes([]);
    if (progressInterval.current) {
      clearInterval(progressInterval.current);
      progressInterval.current = null;
    }
  }, []);

  function startProgressTracking() {
    if (progressInterval.current) clearInterval(progressInterval.current);
    progressInterval.current = setInterval(() => {
      const transport = Tone.getTransport();
      setProgress(transport.seconds * playbackSpeedRef.current);
    }, 100);
  }

  /**
   * Re-schedule all MIDI parts from a given time offset.
   * The transport should be stopped/paused before calling this.
   */
  function rescheduleFrom(time: number) {
    const midi = midiRef.current;
    const piano = pianoRef.current;
    if (!midi || !piano) return;

    const speed = playbackSpeedRef.current;
    const transport = Tone.getTransport();
    transport.cancel();
    partsRef.current.forEach((p) => p.dispose());
    partsRef.current = [];

    midi.tracks.forEach((track) => {
      if (track.notes.length === 0) return;

      const part = new Tone.Part(
        (
          t,
          note: { name: string; duration: number; velocity: number; originalDuration: number },
        ) => {
          if (disposedRef.current) return;
          piano.start({
            note: note.name,
            time: t,
            duration: note.duration,
            velocity: note.velocity,
          });
          setActiveNotes((prev) => [...new Set([...prev, note.name])]);
          setTimeout(
            () => {
              setActiveNotes((prev) => prev.filter((n) => n !== note.name));
            },
            (note.originalDuration * 1000) / speed,
          );
        },
        track.notes.map((n) => ({
          time: (n.time + LEAD_IN_SEC) / speed,
          name: n.name,
          duration: n.duration / speed,
          originalDuration: n.duration,
          velocity: n.velocity,
        })),
      );

      part.start(0);
      partsRef.current.push(part);
    });

    transport.schedule(
      () => {
        stopPlayback();
      },
      durationRef.current / speed + 1,
    );
  }

  const seekTo = useCallback(
    (time: number) => {
      const clamped = Math.max(0, Math.min(time, duration));
      const transport = Tone.getTransport();
      const wasPlaying = transport.state === "started";

      // Release any ringing notes
      pianoRef.current?.stop();
      setActiveNotes([]);

      transport.pause();
      rescheduleFrom(clamped);
      transport.seconds = clamped / playbackSpeedRef.current;
      setProgress(clamped);

      if (wasPlaying) {
        transport.start();
        startProgressTracking();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [duration, stopPlayback],
  );

  const skip = useCallback(
    (seconds: number) => {
      const transport = Tone.getTransport();
      const virtualTime = transport.seconds * playbackSpeedRef.current;
      seekTo(virtualTime + seconds);
    },
    [seekTo],
  );

  const togglePlayback = useCallback(async () => {
    const transport = Tone.getTransport();

    if (isPlaying) {
      transport.pause();
      setIsPlaying(false);
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
        progressInterval.current = null;
      }
      return;
    }

    await Tone.start();

    const midi = midiRef.current;
    const piano = pianoRef.current;
    if (!midi || !piano) return;

    if (transport.state === "paused") {
      transport.start();
      setIsPlaying(true);
      startProgressTracking();
      return;
    }

    transport.cancel();
    partsRef.current.forEach((p) => p.dispose());
    partsRef.current = [];
    transport.position = 0;

    const speed = playbackSpeedRef.current;

    midi.tracks.forEach((track) => {
      if (track.notes.length === 0) return;

      const part = new Tone.Part(
        (
          time,
          note: { name: string; duration: number; velocity: number; originalDuration: number },
        ) => {
          if (disposedRef.current) return;
          piano.start({
            note: note.name,
            time: time,
            duration: note.duration,
            velocity: note.velocity,
          });
          setActiveNotes((prev) => [...new Set([...prev, note.name])]);
          setTimeout(
            () => {
              setActiveNotes((prev) => prev.filter((n) => n !== note.name));
            },
            (note.originalDuration * 1000) / speed,
          );
        },
        track.notes.map((n) => ({
          time: (n.time + LEAD_IN_SEC) / speed,
          name: n.name,
          duration: n.duration / speed,
          originalDuration: n.duration,
          velocity: n.velocity,
        })),
      );

      part.start(0);
      partsRef.current.push(part);
    });

    transport.schedule(
      () => {
        stopPlayback();
      },
      durationRef.current / speed + 1,
    );

    transport.start();
    setIsPlaying(true);
    startProgressTracking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, duration, stopPlayback]);

  const formatTime = useCallback((seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }, []);

  const setPlaybackSpeed = useCallback((speed: number) => {
    const clamped = Math.max(0.01, speed);
    const oldSpeed = playbackSpeedRef.current;
    playbackSpeedRef.current = clamped;
    setPlaybackSpeedState(clamped);

    const transport = Tone.getTransport();
    if (transport.state === "started") {
      // Convert current transport position back to virtual (original) time
      const virtualTime = transport.seconds * oldSpeed;
      pianoRef.current?.stop();
      setActiveNotes([]);
      transport.pause();
      rescheduleFrom(virtualTime);
      transport.seconds = virtualTime / clamped;
      setProgress(virtualTime);
      transport.start();
      startProgressTracking();
    } else if (transport.state === "paused") {
      // Paused: reschedule at the new speed so resume plays correctly
      const virtualTime = transport.seconds * oldSpeed;
      pianoRef.current?.stop();
      setActiveNotes([]);
      rescheduleFrom(virtualTime);
      transport.seconds = virtualTime / clamped;
      setProgress(virtualTime);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getAllNotes = useCallback((): NoteEvent[] => {
    const midi = midiRef.current;
    if (!midi) return [];
    const notes: NoteEvent[] = [];
    midi.tracks.forEach((track, trackIndex) => {
      track.notes.forEach((n) => {
        notes.push({
          time: n.time + LEAD_IN_SEC,
          duration: n.duration,
          midi: n.midi,
          name: n.name,
          velocity: n.velocity,
          track: trackIndex,
        });
      });
    });
    return notes;
  }, []);

  return {
    state: {
      loadState,
      error,
      title,
      isPlaying,
      progress,
      duration,
      bpm,
      noteCount,
      trackCount,
      activeNotes,
      keySignature,
      timeSignature,
      playbackSpeed,
    },
    controls: {
      togglePlayback,
      stopPlayback,
      seekTo,
      skip,
      formatTime,
      getAllNotes,
      setPlaybackSpeed,
    },
    refs: {
      midiRef,
      pianoRef,
    },
  };
}
