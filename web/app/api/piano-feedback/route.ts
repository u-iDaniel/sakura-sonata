import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

// ── Types ────────────────────────────────────────────────────────────

type PracticeSummary = {
  pieceTitle: string;
  mode: "discrete" | "continuous" | "flowing";
  totalSteps: number;

  attempts: number;
  hits: number;
  wrongs: number;
  accuracyPct: number;

  topWrong: { midi: number; note: string; count: number }[];
  topMissed: { midi: number; note: string; count: number }[];
  hotspots: { step: number; fails: number }[];
  playbackSpeed: number;
};

// ── Prompt builders ──────────────────────────────────────────────────

function describeSummary(s: PracticeSummary): string {
  const lines: string[] = [];

  lines.push(`Piece: "${s.pieceTitle}"`);
  lines.push(`Practice mode: ${s.mode}`);
  lines.push(`Playback speed: ${s.playbackSpeed}x`);
  lines.push(`The piece has ${s.totalSteps} note steps in total.`);

  if (s.mode === "flowing") {
    // In flowing mode, attempts = total notes in the piece, hits = correctly matched notes
    lines.push(
      `This was a flowing (play-along) session. The piece contained ${s.totalSteps} notes. ` +
        `The student matched ${s.hits} notes correctly, missed ${s.topMissed.reduce((a, n) => a + n.count, 0)} notes, ` +
        `and hit ${s.topWrong.reduce((a, n) => a + n.count, 0)} wrong notes (${s.accuracyPct}% accuracy).`,
    );
  } else {
    lines.push(
      `The student was evaluated on ${s.attempts} individual note steps: ` +
        `${s.hits} correct, ${s.wrongs} incorrect (${s.accuracyPct}% accuracy).`,
    );
  }

  if (s.topWrong.length > 0) {
    lines.push(
      `Most frequently played wrong notes: ` +
        s.topWrong.map((n) => `${n.note} (${n.count}×)`).join(", ") +
        ".",
    );
  }

  if (s.topMissed.length > 0) {
    lines.push(
      `Most frequently missed (not played) notes: ` +
        s.topMissed.map((n) => `${n.note} (${n.count}×)`).join(", ") +
        ".",
    );
  }

  if (s.hotspots.length > 0) {
    lines.push(
      `Hardest spots in the piece (step number → fail count): ` +
        s.hotspots.map((h) => `step ${h.step} (${h.fails} fails)`).join(", ") +
        ".",
    );
    lines.push(
      `(Note: Steps represent positions in the song — step 0 is the very beginning, and higher step numbers are further into the piece. If there are ${s.totalSteps} total steps, a hotspot at step ${Math.round(s.totalSteps / 2)} would be roughly halfway through.)`,
    );
  }

  return lines.join("\n");
}

function buildSummaryPrompt(summary: PracticeSummary) {
  return `
You are a supportive piano teacher reviewing a student's results from a
single practice session in an interactive practice app.

Context:
- The app shows falling notes on screen; the student plays them on a MIDI keyboard.
- Each "note event" is one moment where the app expected specific note(s) and the
  student either hit them correctly or made an error.
- "accuracy" = correct note events / total note events in this one run.
- "wrong notes" = keys the student pressed that were not expected.
- "missed notes" = expected keys the student failed to press.
- "hotspots" = specific steps (parts of the song) where the student failed most often.
- "playback speed" = the speed at which the song was played (1x is normal speed, <1x is slower, >1x is faster).

Student's results from this practice run:
${describeSummary(summary)}

Write 120–180 words of personalised feedback.
Requirements:
- Start with one genuine positive observation about their effort or any strength
  you can identify (e.g. completing a long piece, certain sections going well).
- Name the top 1–2 specific recurring problem notes or hotspots. If mentioning hotspots,
  explain that they are struggling with a specific section of the song (e.g. "around step 45").
- Give exactly 3 concise, actionable practice tips as markdown bullet points.
- If the playback speed is less than 1x, encourage them to keep practicing at a slow speed until they are comfortable. If it is 1x or higher, praise them for practicing at tempo.
- Scale your tone to the accuracy: ≥80% → celebratory, 40-79% → encouraging,
  <40% → empathetic and motivating (never discouraging).
- Never mention "JSON", "data", "API", "note events", or "MIDI numbers".
`.trim();
}

// ── Handler ──────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session || !session.user || !session.session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    // Determine which payload shape was sent:
    //   { summary: PracticeSummary }  — from PracticeTab
    //   { prompt: string }            — from PracticeModal
    let prompt: string;

    if (body?.summary && typeof body.summary === "object") {
      prompt = buildSummaryPrompt(body.summary as PracticeSummary);
    } else if (body?.prompt && typeof body.prompt === "string") {
      prompt = body.prompt;
    } else {
      return NextResponse.json(
        { error: "Request must include either `summary` (object) or `prompt` (string)." },
        { status: 400 },
      );
    }

    const ai = new GoogleGenAI({});
    const resp = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const text = (resp.text ?? "").trim();
    return NextResponse.json({ text });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[piano-feedback]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
