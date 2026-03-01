"use client";

import { Suspense, useState, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  Loader2,
  Music,
  Piano,
  Maximize2,
  Minimize2,
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
  const [pianoKey, setPianoKey] = useState("splendid");
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

  useEffect(() => {
    if (!isPending && !session) {
      router.replace("/auth/login");
    }
  }, [isPending, session, router]);

  if (isPending || !session) {
    return (
      <div className="min-h-screen w-full bg-[#FFF6EB] flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-pink-400 animate-spin" />
      </div>
    );
  }

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
    setIsFullscreen((prev) => !prev);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) setIsFullscreen(false);
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
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-pink-400 hover:text-pink-500 transition-colors font-medium text-sm"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`w-full bg-[#FFF6EB] flex flex-col items-center overflow-hidden transition-all duration-300 ${
        isFullscreen
          ? "fixed inset-0 z-50 p-2 md:p-4"
          : "relative min-h-screen p-6"
      }`}
    >
      <div className="absolute inset-0 z-0 pointer-events-none">
        <SakuraBackground />
      </div>

      {/* Header */}
      {!isFullscreen && (
        <div className="z-10 w-full max-w-6xl">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 mb-6 text-slate-400 hover:text-pink-400 transition-colors font-medium text-sm group"
          >
            <ChevronLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            Back to My Sonatas
          </Link>
        </div>
      )}

      {/* Main Card */}
      <div
        className={`z-10 w-full bg-white/70 backdrop-blur-md border border-pink-100 transition-all duration-300 ${
          isFullscreen
            ? "max-w-full flex-1 min-h-0 rounded-2xl p-4 md:p-6 flex flex-col gap-4 overflow-hidden"
            : "max-w-6xl rounded-3xl p-8 md:p-10 space-y-8"
        }`}
      >
        {/* Title & metadata */}
        <div className="text-center space-y-2 shrink-0">
          <div className="flex items-center justify-center gap-3 min-w-0 max-w-full">
            {isFullscreen && (
              <Link
                href="/dashboard"
                className="text-slate-400 hover:text-pink-400 transition-colors"
                title="Back to My Sonatas"
              >
                <ChevronLeft className="w-5 h-5" />
              </Link>
            )}
            <h1
              className={`font-serif text-[#2D3142] truncate max-w-full ${
                isFullscreen ? "text-xl md:text-2xl" : "text-3xl md:text-4xl"
              }`}
              title={title || undefined}
            >
              {title || "Loading…"}
            </h1>
            <button
              onClick={toggleFullscreen}
              className="text-slate-400 hover:text-pink-400 transition-colors p-1 rounded-lg hover:bg-pink-50"
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
            >
              {isFullscreen ? (
                <Minimize2 className="w-5 h-5" />
              ) : (
                <Maximize2 className="w-5 h-5" />
              )}
            </button>
          </div>
          {loadState === "ready" && !isFullscreen && (
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
              className={`w-full ${
                isFullscreen ? "flex-1 flex flex-col min-h-0" : ""
              }`}
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

              <TabsContent
                value="falling-notes"
                className={`${
                  isFullscreen
                    ? "flex-1 min-h-0 relative overflow-hidden"
                    : "mt-4"
                }`}
              >
                <FallingNotesTab
                  state={state}
                  controls={controls}
                  isFullscreen={isFullscreen}
                  pianoSwitcher={pianoSwitcherEl}
                  playbackSpeed={playbackSpeed}
                  midiRef={refs.midiRef}
                  pianoFactory={pianoFactory}
                />
              </TabsContent>

              <TabsContent value="audio-player" className="mt-4">
                <AudioPlayerTab
                  state={state}
                  controls={controls}
                  pianoSwitcher={pianoSwitcherEl}
                />
              </TabsContent>

              <TabsContent
                value="practice"
                className={`${
                  isFullscreen
                    ? "flex-1 min-h-0 relative overflow-hidden"
                    : "mt-4"
                }`}
              >
                <PracticeTab
                  state={state}
                  controls={controls}
                  refs={refs}
                  isFullscreen={isFullscreen}
                  pianoSwitcher={pianoSwitcherEl}
                  playbackSpeed={playbackSpeed}
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
