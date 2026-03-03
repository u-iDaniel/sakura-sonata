/**
 * Shared AudioContext utilities for iOS Safari compatibility.
 *
 * iOS Safari creates AudioContext in a suspended state and only allows
 * it to be resumed inside a direct user-gesture handler (click/touch).
 * This module centralises the "unlock" logic so every entry point
 * (playback, practice mode, etc.) goes through the same path.
 */

import * as Tone from "tone";

let unlocked = false;

/**
 * Ensure the Tone.js AudioContext is created AND running.
 * Must be called from a user-gesture handler (click / touchend).
 *
 * Safe to call multiple times — subsequent calls are near-instant.
 */
export async function ensureAudioContext(): Promise<AudioContext> {
  await Tone.start();

  const ctx = Tone.getContext().rawContext as AudioContext;

  // iOS Safari sometimes needs a silent buffer played to fully unlock
  // the audio output path, even after AudioContext.resume() succeeds.
  if (!unlocked) {
    try {
      const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
    } catch {
      // Non-critical — Tone.start() already resumed the context.
    }
    unlocked = true;
  }

  return ctx;
}
