"use client";

import { useEffect, useState } from "react";
import { Trash2, Plus, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { LogoutButton } from "@/components/logout-button";
import Link from "next/link";
import { SakuraBackground } from "@/components/SakuraBackground";

type Score = {
  id: string;
  title: string | null;
  file_url: string | null;
  created_at: string | null;
  user_id?: string | null;
};

export default function DashboardPage() {
  const [scores, setScores] = useState<Score[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const fetchScores = async () => {
      try {
        const res = await fetch("/api/music/scores");
        if (!res.ok) {
          const errorData = await res.json();
          errorData?.error ? setErrorText(errorData.error) : setErrorText("Failed to fetch scores");
          setLoading(false);
          return;
        }

        const data: Score[] = await res.json();
        setScores(data);
        setLoading(false);
      } catch (err) {
        console.error("Error fetching scores:", err);
        setErrorText("An error occurred while fetching scores.");
        setLoading(false);
      }
    };
    fetchScores();
  }, []);

  const handleDelete = async (score: Score) => {
    try {
      setDeletingId(score.id);
      const res = await fetch(`/api/music/score?id=${score.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const errorData = await res.json();
        console.error("Delete failed:", errorData);
        alert(
          errorData?.error
            ? `Failed to delete: ${errorData.error}`
            : "Failed to delete. Check console for details.",
        );
        return;
      }
      setScores((prev) => prev.filter((s) => s.id !== score.id));
    } catch (err) {
      console.error("Delete failed:", err);
      alert("Failed to delete. Check console for details.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="relative flex h-screen w-screen font-inter bg-sakura-bg">
      {/* Sakura petals background (behind everything) */}
      <SakuraBackground />

      {/* Foreground content */}
      <div className="relative z-10 h-full w-full overflow-hidden">
        <div className="absolute top-6 left-8 right-8 z-20 flex justify-between items-center">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <span className="text-2xl text-pink-400">✦</span>
            <span className="text-[#2D3142] text-3xl font-fasthand">Sakura Sonata</span>
          </Link>
          <LogoutButton
            label="Log out"
            className="h-10 rounded-full bg-white/60 px-4 text-sakura-dark/70 hover:bg-white hover:text-sakura-text-pink"
          />
        </div>

        <main className="h-full p-10 pb-32 overflow-y-auto scrollbar-hide">
          <div className="mb-8 mt-20">
            <h1 className="text-5xl font-bold text-sakura-text-pink mb-2">My Sonatas</h1>
            <p className="text-sakura-dark/50 text-lg">Your collection of music compositions</p>
          </div>

          {loading ? (
            <div className="text-sakura-dark/60 text-lg">
              Loading your sonatas...
              <Loader2 className="inline-block w-5 h-5 animate-spin ml-2 text-sakura-dark/60" />
            </div>
          ) : errorText !== null ? (
            <div className="text-red-500 text-lg">{errorText}</div>
          ) : scores.length === 0 ? (
            <div className="text-sakura-dark/60 text-lg">
              No compositions yet. Upload one to get started!
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-6">
              {scores.map((score) => (
                <div
                  key={score.id}
                  className="cursor-pointer relative rounded-2xl bg-white/80 backdrop-blur-sm p-6 transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl hover:bg-white"
                  style={{ boxShadow: "0 4px 24px rgba(217, 108, 142, 0.12)" }}
                  onClick={() => router.push(`/tutorial/${score.id}`)}
                >
                  {/* Delete button */}
                  <button
                    type="button"
                    className="absolute top-4 right-4 p-2 rounded-full hover:bg-pink-50 text-sakura-text-pink/80 hover:text-sakura-text-pink transition disabled:opacity-50"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(score);
                    }}
                    disabled={deletingId === score.id}
                    aria-label="Delete composition"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <div className="flex h-32 flex-col justify-between">
                    <div className="pr-10">
                      <h3 className="text-lg font-semibold text-sakura-text-pink">
                        {score.title?.trim() ? score.title : "Untitled"}
                      </h3>
                    </div>

                    <div className="flex justify-between items-center">
                      <p className="text-sakura-dark/40 text-xs">
                        {score.created_at ? new Date(score.created_at).toLocaleDateString() : ""}
                      </p>

                      <div className="flex items-center gap-2">
                        {deletingId === score.id ? (
                          <span className="text-xs text-sakura-dark/40">Deleting…</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      <button
        onClick={() => router.push("/dashboard/new")}
        className="fixed bottom-8 right-8 z-50 w-16 h-16 rounded-full bg-sakura-text-pink text-white shadow-lg hover:shadow-xl hover:scale-110 active:scale-95 transition-all duration-200 flex items-center justify-center"
        style={{ boxShadow: "0 8px 32px rgba(217, 108, 142, 0.4)" }}
        aria-label="New composition"
        title="New Composition"
      >
        <Plus className="w-7 h-7" />
      </button>
    </div>
  );
}
