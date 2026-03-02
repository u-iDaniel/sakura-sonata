"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SakuraBackground } from "@/components/SakuraBackground";
import Link from "next/link";
import { Upload, Loader2 } from "lucide-react";
import { ChevronLeft } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export default function NewCompositionPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<string>("");
  const [errorText, setErrorText] = useState<string>("");
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!isPending && !session) {
      router.replace("/auth/login");
    }
  }, [isPending, session, router]);

  const uploadFile = async (file: File) => {
    try {
      setStatus("Uploading...");
      setErrorText("");

      // Quick client-side checks before hitting the server
      const name = file.name.toLowerCase();
      const isMidi =
        file.type === "audio/midi" ||
        name.endsWith(".mid") ||
        name.endsWith(".midi");
      if (!isMidi) {
        setStatus("");
        setErrorText("Please upload a MIDI file (.mid or .midi).");
        return;
      }

      const maxBytes = 10 * 1024 * 1024;
      if (file.size > maxBytes) {
        setStatus("");
        setErrorText("File too large (max 10MB).");
        return;
      }

      const formData = new FormData();
      formData.append("file", file); // key is "file", value is the File object

      const res = await fetch("/api/storage/midi", {
        method: "POST",
        body: formData,
      });

      const body = await res.json();

      if (!res.ok) {
        setStatus("");
        setErrorText(body.error ?? "Upload failed");
        return;
      }

      setStatus("");
      router.push(`/tutorial/${body.scoreId}`);
    } catch (e: any) {
      setStatus("");
      setErrorText(`Upload error: ${e?.message ?? "Unknown error"}`);
    }
  };

  if (isPending || !session) {
    return (
      <div className="min-h-screen w-full bg-[#FFF6EB] flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-pink-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen w-full bg-[#FFF6EB] flex flex-col items-center justify-center overflow-hidden p-6">
      <div className="absolute inset-0 z-0 pointer-events-none">
        <SakuraBackground />
      </div>

      {/* Back Button */}
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 mb-8 text-slate-400 hover:text-pink-400 transition-colors font-medium text-sm group"
      >
        <ChevronLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
        Back to My Sonatas
      </Link>

      <div className="z-10 flex flex-col items-center w-full max-w-2xl text-center space-y-6">
        <h1 className="text-4xl font-serif text-[#2D3142]">New Composition</h1>
        <p className="text-slate-500">Drop your MIDI file to begin</p>

        {/* Hidden file input for click-to-upload */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".mid,.midi,audio/midi"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadFile(file);
            e.currentTarget.value = ""; // allow selecting same file again
          }}
        />

        <div
          role="button"
          tabIndex={0}
          className="w-full border-2 border-dashed border-pink-200 rounded-[2.5rem] bg-white/60 backdrop-blur-md p-16 flex flex-col items-center gap-4 transition-all hover:bg-white/80 cursor-pointer group outline-none focus:ring-2 focus:ring-pink-200"
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file) uploadFile(file);
          }}
        >
          <div className="p-4 bg-pink-50 rounded-full text-pink-400 group-hover:scale-110 transition-transform">
            <Upload className="w-10 h-10" />
          </div>
          <p className="text-[#2D3142] font-medium text-lg">
            Drag & drop or click to upload
          </p>
          <span className="text-sm text-slate-400">MIDI • Max 10MB</span>
        </div>

        {status && (
          <div className="w-full bg-white/70 border border-pink-100 p-4 rounded-xl">
            <p className="text-slate-600 text-sm">{status}</p>
          </div>
        )}

        {errorText && (
          <div className="w-full space-y-3">
            <div className="bg-red-50 border border-red-200 p-4 rounded-xl">
              <p className="text-red-600 text-sm">{errorText}</p>
            </div>
            <Link
              href="https://forms.gle/EJqinZh2knDvv4ck7"
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-10 rounded-full bg-white/60 px-4 text-sakura-dark/70 hover:bg-white hover:text-sakura-text-pink transition-colors text-sm font-medium shadow hover:bg-primary/90 items-center justify-center text-center w-full"
            >
              Report Issue
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
