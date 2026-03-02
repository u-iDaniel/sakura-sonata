"use client";

import { Suspense, useState, useCallback, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  Loader2,
  Music,
  Piano,
  Volume2,
  Gamepad2,
} from "lucide-react";
import { SakuraBackground } from "@/components/SakuraBackground";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { AudioPlayerTab } from "@/components/AudioPlayerTab";
import { FallingNotesTab } from "@/components/FallingNotesTab";
import { PracticeTab } from "@/components/PracticeTab";
import { PlaybackSpeedControl } from "@/components/PlaybackSpeedControl";
import { useMidiPlayer } from "@/lib/hooks/useMidiPlayer";
import type { PianoPlayerFactory } from "@/lib/piano";
import { splendidPiano, salamanderPiano, soundfontPiano } from "@/lib/piano";
import { authClient } from "@/lib/auth-client";

export default function TutorialPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen w-full bg-[#FFF6EB] flex items-center justify-center">
          <Loader2 className="w-10 h-10 text-pink-400 animate-spin" />
        </div>
      }
    >
      <TutorialContent />
    </Suspense>
  );
}

const PIANO_OPTIONS: {
  value: string;
  label: string;
  description: string;
  factory: PianoPlayerFactory;
}[] = [
  {
    value: "splendid",
    label: "Splendid Grand",
    description: "Rich SoundFont piano",
    factory: splendidPiano,
  },
  {
    value: "salamander",
    label: "Salamander",
    description: "Clean sampled piano",
    factory: salamanderPiano,
  },
  {
    value: "soundfont",
    label: "Gentle",
    description: "Soft MusyngKite SoundFont",
    factory: soundfontPiano,
  },
];

function TutorialContent() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [pianoKey, setPianoKeyState] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("pianoSound");
      if (saved && PIANO_OPTIONS.some((o) => o.value === saved)) return saved;
    }
    return "splendid";
  });
  const setPianoKey = useCallback((key: string) => {
    setPianoKeyState(key);
    localStorage.setItem("pianoSound", key);
  }, []);
  const pianoFactory = PIANO_OPTIONS.find((o) => o.value === pianoKey)!.factory;
  const { state, controls, refs } = useMidiPlayer(id, pianoFactory);
  const {
    loadState,
    error,
    title,
    bpm,
    noteCount,
    trackCount,
    duration,
    keySignature,
    timeSignature,
    playbackSpeed,
  } = state;
  const { formatTime, setPlaybackSpeed } = controls;
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeTab, setActiveTab] = useState("falling-notes");
  const fullscreenRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isPending && !session) {
      router.replace("/auth/login");
    }
  }, [isPending, session, router]);

  // ── Browser Fullscreen API ──────────────────────────────────────────
  const enterFullscreen = useCallback(() => {
    const el = fullscreenRef.current;
    if (!el) return;
    const requestFS =
      el.requestFullscreen ??
      (el as any).webkitRequestFullscreen ??
      (el as any).msRequestFullscreen;
    if (requestFS) {
      requestFS.call(el).catch(() => {
        // Fallback: CSS-only fullscreen (e.g. iOS Safari)
        setIsFullscreen(true);
      });
    } else {
      // No API support — CSS fallback
      setIsFullscreen(true);
    }
  }, []);

  const exitFullscreen = useCallback(() => {
    const exitFS =
      document.exitFullscreen ??
      (document as any).webkitExitFullscreen ??
      (document as any).msExitFullscreen;
    if (exitFS && document.fullscreenElement) {
      exitFS.call(document).catch(() => setIsFullscreen(false));
    } else {
      setIsFullscreen(false);
    }
  }, []);

  // Sync isFullscreen state with browser fullscreen events
  useEffect(() => {
    const onFSChange = () => {
      const fsEl =
        document.fullscreenElement ??
        (document as any).webkitFullscreenElement ??
        (document as any).msFullscreenElement;
      setIsFullscreen(!!fsEl);
    };
    document.addEventListener("fullscreenchange", onFSChange);
    document.addEventListener("webkitfullscreenchange", onFSChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFSChange);
      document.removeEventListener("webkitfullscreenchange", onFSChange);
    };
  }, []);

  // Stop audio playback when switching to the Practice tab
  const handleTabChange = useCallback(
    (tab: string) => {
      setActiveTab(tab);
      if (tab === "practice" && state.isPlaying) {
        controls.stopPlayback();
      }
    },
    [state.isPlaying, controls],
  );

  const pianoSwitcherEl = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1.5 rounded-full bg-white/80 backdrop-blur-md border border-pink-100 shadow-sm px-3 py-1.5 text-xs text-slate-500 hover:text-pink-600 hover:border-pink-200 transition-all"
          title="Switch piano sound"
        >
          <Volume2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">
            {PIANO_OPTIONS.find((o) => o.value === pianoKey)?.label}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-56">
        <DropdownMenuLabel>Piano Sound</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={pianoKey} onValueChange={setPianoKey}>
          {PIANO_OPTIONS.map((opt) => (
            <DropdownMenuRadioItem key={opt.value} value={opt.value}>
              <div>
                <div className="font-medium">{opt.label}</div>
                <div className="text-xs text-slate-400">{opt.description}</div>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const toggleFullscreen = useCallback(() => {
    if (isFullscreen) {
      exitFullscreen();
    } else {
      enterFullscreen();
    }
  }, [isFullscreen, enterFullscreen, exitFullscreen]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Escape for CSS-only fallback (browser already handles it for real fullscreen)
      if (e.key === "Escape" && isFullscreen && !document.fullscreenElement) {
        setIsFullscreen(false);
      }
      if (loadState !== "ready") return;
      // Disable playback shortcuts when on the Practice tab
      if (activeTab === "practice") return;
      if (e.key === " ") {
        e.preventDefault();
        controls.togglePlayback();
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        controls.skip(-5);
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        controls.skip(5);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isFullscreen, loadState, controls, activeTab]);

  // ─── Render ─────────────────────────────────────────────
  if (loadState === "error") {
    return (
      <div className="relative min-h-screen w-full bg-[#FFF6EB] flex flex-col items-center justify-center p-6">
        <div className="absolute inset-0 z-0 pointer-events-none">
          <SakuraBackground />
        </div>
        <div className="z-10 bg-white/70 backdrop-blur-md rounded-3xl border border-pink-100 p-10 max-w-md text-center space-y-4">
          <h1 className="text-2xl font-serif text-[#2D3142]">Error</h1>
          <p className="text-slate-500">{error}</p>
          <div className="flex flex-col gap-3 pt-2">
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center gap-2 text-pink-400 hover:text-pink-500 transition-colors font-medium text-sm"
            >
              <ChevronLeft className="w-4 h-4" />
              Back to Dashboard
            </Link>
            <Link
              href="https://forms.gle/EJqinZh2knDvv4ck7"
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-10 rounded-full bg-white/60 px-4 text-sakura-dark/70 hover:bg-white hover:text-sakura-text-pink transition-colors text-sm font-medium shadow hover:bg-primary/90 items-center justify-center text-center"
            >
              Report Issue
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (isPending || !session) {
    return (
      <div className="min-h-screen w-full bg-[#FFF6EB] flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-pink-400 animate-spin" />
      </div>
    );
  }

  // Piano options without the factory (for the fullscreen settings menu)
  const pianoOptionsForSettings = PIANO_OPTIONS.map(
    ({ value, label, description }) => ({
      value,
      label,
      description,
      factory: PIANO_OPTIONS.find((o) => o.value === value)!.factory,
    }),
  );

  // ── Fullscreen content (rendered in a portal-like ref container) ────
  const fullscreenContent = isFullscreen ? (
    activeTab === "practice" ? (
      <PracticeTab
        state={state}
        controls={controls}
        refs={refs}
        isFullscreen
        playbackSpeed={playbackSpeed}
        onExitFullscreen={exitFullscreen}
        setPlaybackSpeed={setPlaybackSpeed}
        originalBpm={bpm}
        pianoOptions={pianoOptionsForSettings}
        pianoKey={pianoKey}
        setPianoKey={setPianoKey}
      />
    ) : (
      <FallingNotesTab
        state={state}
        controls={controls}
        isFullscreen
        playbackSpeed={playbackSpeed}
        midiRef={refs.midiRef}
        pianoFactory={pianoFactory}
        onExitFullscreen={exitFullscreen}
        setPlaybackSpeed={setPlaybackSpeed}
        originalBpm={bpm}
        pianoOptions={pianoOptionsForSettings}
        pianoKey={pianoKey}
        setPianoKey={setPianoKey}
      />
    )
  ) : null;

  return (
    <div className="w-full bg-[#FFF6EB] flex flex-col items-center overflow-hidden relative min-h-screen p-6">
      <div className="absolute inset-0 z-0 pointer-events-none">
        <SakuraBackground />
      </div>

      {/* Fullscreen container — this is what gets fullscreened via the API */}
      <div
        ref={fullscreenRef}
        className={isFullscreen ? "fixed inset-0 z-50 bg-black" : "hidden"}
        style={isFullscreen ? undefined : { display: "none" }}
      >
        {fullscreenContent}
      </div>

      {/* Header */}
      <div className="z-10 w-full max-w-6xl">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 mb-6 text-slate-400 hover:text-pink-400 transition-colors font-medium text-sm group"
        >
          <ChevronLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Back to My Sonatas
        </Link>
      </div>

      {/* Main Card */}
      <div className="z-10 w-full bg-white/70 backdrop-blur-md border border-pink-100 max-w-6xl rounded-3xl p-8 md:p-10 space-y-8">
        {/* Title & metadata */}
        <div className="text-center space-y-2 shrink-0">
          <h1
            className="font-serif text-[#2D3142] truncate max-w-full text-3xl md:text-4xl"
            title={title || undefined}
          >
            {title || "Loading…"}
          </h1>
          {loadState === "ready" && (
            <p className="text-sm text-slate-400">
              {trackCount} track{trackCount !== 1 && "s"} · {noteCount} notes ·{" "}
              {bpm} BPM · {timeSignature} · {keySignature} ·{" "}
              {formatTime(duration)}
            </p>
          )}
        </div>

        {/* Loading indicator */}
        {loadState === "loading" && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="w-10 h-10 text-pink-400 animate-spin" />
            <p className="text-slate-400 text-sm">Loading piano samples…</p>
          </div>
        )}

        {/* Tabs */}
        {loadState === "ready" && (
          <>
            <Tabs
              defaultValue="falling-notes"
              onValueChange={handleTabChange}
              className="w-full"
            >
              <TabsList className="w-full justify-center bg-pink-50/80 border border-pink-100 rounded-xl p-1 shrink-0">
                <TabsTrigger
                  value="falling-notes"
                  className="flex-1 gap-1.5 rounded-lg data-[state=active]:bg-white data-[state=active]:text-pink-600 data-[state=active]:shadow-sm text-slate-500 transition-all text-sm"
                >
                  <Piano className="w-4 h-4" />
                  Falling Notes
                </TabsTrigger>
                <TabsTrigger
                  value="audio-player"
                  className="flex-1 gap-1.5 rounded-lg data-[state=active]:bg-white data-[state=active]:text-pink-600 data-[state=active]:shadow-sm text-slate-500 transition-all text-sm"
                >
                  <Music className="w-4 h-4" />
                  Audio Player
                </TabsTrigger>
                <TabsTrigger
                  value="practice"
                  className="flex-1 gap-1.5 rounded-lg data-[state=active]:bg-white data-[state=active]:text-pink-600 data-[state=active]:shadow-sm text-slate-500 transition-all text-sm"
                >
                  <Gamepad2 className="w-4 h-4" />
                  Practice
                </TabsTrigger>
              </TabsList>

              <TabsContent value="falling-notes" className="mt-4">
                <FallingNotesTab
                  state={state}
                  controls={controls}
                  pianoSwitcher={pianoSwitcherEl}
                  playbackSpeed={playbackSpeed}
                  midiRef={refs.midiRef}
                  pianoFactory={pianoFactory}
                  toggleFullscreen={toggleFullscreen}
                />
              </TabsContent>

              <TabsContent value="audio-player" className="mt-4">
                <AudioPlayerTab
                  state={state}
                  controls={controls}
                  pianoSwitcher={pianoSwitcherEl}
                />
              </TabsContent>

              <TabsContent value="practice" className="mt-4">
                <PracticeTab
                  state={state}
                  controls={controls}
                  refs={refs}
                  pianoSwitcher={pianoSwitcherEl}
                  playbackSpeed={playbackSpeed}
                  toggleFullscreen={toggleFullscreen}
                />
              </TabsContent>
            </Tabs>

            {/* Playback speed control */}
            <div className="mt-4">
              <PlaybackSpeedControl
                playbackSpeed={playbackSpeed}
                setPlaybackSpeed={setPlaybackSpeed}
                originalBpm={bpm}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
