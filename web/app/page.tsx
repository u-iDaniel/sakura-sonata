import { SakuraBackground } from "@/components/SakuraBackground";
import { LandingPageHeader } from "@/components/LandingPageHeader";
import { Eye, Download, Target } from "lucide-react";
import Link from "next/link";

const features = [
  {
    icon: Eye,
    title: "Instant Visualization",
    description:
      "Upload any MIDI piano file and watch your music come alive with a real-time interactive piano visualization that follows along note by note.",
  },
  {
    icon: Target,
    title: "Practice Mode*",
    description:
      "Learn faster with step-by-step guidance with ultimate interactivity. Up to 3 different practice modes to choose from: flowing, continuous, and discrete.",
    footnote: "MIDI keyboards only for now",
  },
  {
    icon: Download,
    title: "Export Anywhere",
    description:
      "Download your visualizations as video tutorials in .webm format, perfect for sharing on social media or reviewing on any device.",
  },
];

export default function Home() {
  return (
    <main className="relative min-h-screen bg-sakura-bg font-inter scrollbar-hide">
      <SakuraBackground />

      <div className="relative z-10 flex flex-col items-center">
        {/* Header */}
        <LandingPageHeader />

        {/* Hero Section */}
        <section className="flex flex-col items-center justify-center px-4 pt-24 pb-20 text-center">
          <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight text-sakura-text-pink sm:text-5xl md:text-6xl">
            Animated Playable Piano Tutorials in Seconds
          </h1>
          <Link
            href="/auth/sign-up"
            className="mt-10 inline-block rounded-full bg-sakura-pink px-10 py-4 text-lg font-semibold text-white shadow-lg shadow-sakura-pink/30 transition-all hover:shadow-xl hover:shadow-sakura-pink/40 hover:bg-sakura-pink/90"
          >
            Get Started
          </Link>
        </section>

        {/* Feature Cards */}
        <section className="w-full max-w-5xl px-4 pb-24">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-2xl bg-white p-8 shadow-md transition-shadow hover:shadow-lg flex flex-col"
              >
                <div className="flex-1">
                  <feature.icon
                    className="mb-4 h-10 w-10 text-sakura-pink"
                    strokeWidth={1.5}
                  />
                  <h3 className="mb-2 text-lg font-semibold text-sakura-text-pink">
                    {feature.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-sakura-dark/70">
                    {feature.description}
                  </p>
                </div>
                {feature.footnote && (
                  <p className="mt-4 text-xs text-sakura-dark/50 border-t border-sakura-dark/10 pt-3">
                    *{feature.footnote}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-auto w-full py-8 text-center text-xs text-sakura-dark/40">
          &copy; 2026 Sakura Sonata. All rights reserved.
        </footer>
      </div>
    </main>
  );
}
