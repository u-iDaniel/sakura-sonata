/**
 * Shared AudioContext utilities for iOS Safari compatibility.
 *
 * iOS Safari creates AudioContext in a suspended state and only allows
 * it to be resumed inside a direct user-gesture handler (click/touch).
 *
 * Older iOS versions (16.x – 17.x) have a further quirk: calling
 * `AudioContext.resume()` alone is NOT enough.  The audio session must
 * first be "activated" by playing sound through a native `<audio>`
 * element.  Only after that does the Web Audio API actually produce
 * output.  This module centralises the multi-step "unlock" logic so
 * every entry point (playback, practice mode, etc.) goes through the
 * same path.
 *
 * @see https://github.com/Tonejs/Tone.js/issues/1051
 * @see https://github.com/danigb/smplr/issues/77
 */

import * as Tone from "tone";

let unlocked = false;

// ---------------------------------------------------------------------------
// iOS detection
// ---------------------------------------------------------------------------
function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  // Classic check — iPhone / iPad / iPod in the UA string.
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return true;
  // Newer iPads report as "Macintosh" but expose multi-touch.
  if (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
    return true;
  return false;
}

// ---------------------------------------------------------------------------
// Native <audio> unlock — required on iOS 16–17 to activate the audio session
// before any Web Audio API output will be heard.
// ---------------------------------------------------------------------------
let nativeAudioUnlocked = false;
let nativeAudioEl: HTMLAudioElement | null = null;

/**
 * Play a tiny silent MP3 via a native `<audio>` element.
 *
 * On iOS Safari this activates the hardware audio session on the *media*
 * channel, which unblocks Web Audio output.  Must be called from a
 * user-gesture handler.
 *
 * On non-iOS browsers (or after the first successful call) this is a no-op.
 */
async function unlockNativeAudio(): Promise<void> {
  if (nativeAudioUnlocked || typeof document === "undefined") return;
  if (!isIOS()) {
    nativeAudioUnlocked = true;
    return;
  }

  try {
    if (!nativeAudioEl) {
      nativeAudioEl = document.createElement("audio");
      nativeAudioEl.src = "/silent.mp3";
      nativeAudioEl.setAttribute("playsinline", "");
      nativeAudioEl.preload = "auto";
      // A tiny, inaudible element — never shown.
      nativeAudioEl.style.display = "none";
      document.body.appendChild(nativeAudioEl);
    }

    await nativeAudioEl.play();
    nativeAudioUnlocked = true;
  } catch {
    // play() can reject if the gesture was consumed — non-fatal.
    // We'll retry on the next user interaction.
  }
}

// ---------------------------------------------------------------------------
// One-shot touchend listener
// ---------------------------------------------------------------------------
let touchListenerAdded = false;

function installTouchUnlockListener(): void {
  if (touchListenerAdded || typeof document === "undefined") return;
  if (!isIOS()) return;

  touchListenerAdded = true;

  const handler = () => {
    // Fire-and-forget — best-effort re-unlock.
    void ensureAudioContext();
    document.removeEventListener("touchend", handler, true);
  };

  document.addEventListener("touchend", handler, true);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensure the Tone.js AudioContext is created AND running.
 * Must be called from a user-gesture handler (click / touchend).
 *
 * Safe to call multiple times — subsequent calls are near-instant.
 */
export async function ensureAudioContext(): Promise<AudioContext> {
  // Step 1 — activate the iOS native audio session (no-op on desktop / once done).
  await unlockNativeAudio();

  // Step 2 — resume the Tone.js (Web Audio) context.
  await Tone.start();

  const ctx = Tone.getContext().rawContext as AudioContext;

  // Step 3 — explicit resume fallback.  On some iOS builds Tone.start()
  // resolves before the context is truly "running".
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      // non-critical
    }
  }

  // Step 4 — silent-buffer trick (belt-and-suspenders for older WebKit).
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

    // Install a one-shot touchend listener so that if the OS re-suspends
    // the context later (phone call, Siri, tab switch) the next tap will
    // re-unlock automatically.
    installTouchUnlockListener();
  }

  // Step 5 — monitor for OS-level re-suspension (phone call, Siri, etc.).
  // Reset the `unlocked` flag so the next user gesture re-runs the unlock.
  if (!ctx.onstatechange) {
    ctx.onstatechange = () => {
      if (ctx.state === "suspended") {
        unlocked = false;
        nativeAudioUnlocked = false;
      }
    };
  }

  return ctx;
}
