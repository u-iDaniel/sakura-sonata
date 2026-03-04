import { auth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/bypass-client";
import { MIDI_BUCKET, SCORES_TABLE } from "@/lib/supabase/constants";
import { headers } from "next/headers";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXTENSIONS = [".mid", ".midi"];

export async function GET(request: Request) {
  const supabase = createClient();
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session || !session.user || !session.session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return Response.json(
      { error: "id query parameter is required" },
      { status: 400 },
    );
  }

  // Fetch the score record to verify ownership and get the storage path
  const { data: score, error: scoreError } = await supabase
    .from(SCORES_TABLE)
    .select("id, title, file_path")
    .eq("id", id)
    .eq("user_id", session.user.id)
    .single();

  if (scoreError || !score) {
    console.error("Error fetching score:", scoreError);
    return Response.json({ error: "Could not fetch score" }, { status: 500 });
  }

  if (!score.file_path) {
    return Response.json(
      { error: "Score has no associated file" },
      { status: 404 },
    );
  }

  const { data, error } = await supabase.storage
    .from(MIDI_BUCKET)
    .download(score.file_path);

  if (error || !data) {
    console.error("Error downloading MIDI file:", error);
    return Response.json(
      { error: "Could not download MIDI file" },
      { status: 500 },
    );
  }

  const blob = new Blob([data], { type: "audio/midi" });
  return new Response(blob, {
    headers: {
      "Content-Type": "audio/midi",
    },
  });
}

export async function POST(request: Request) {
  const supabase = createClient();
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session || !session.user || !session.session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Parse multipart form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  // Validate extension
  const name = file.name.toLowerCase();
  const hasValidExt = ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
  if (!hasValidExt) {
    return Response.json(
      { error: "Only MIDI files (.mid, .midi) are accepted" },
      { status: 400 },
    );
  }

  // Validate size
  if (file.size > MAX_FILE_SIZE) {
    return Response.json(
      { error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` },
      { status: 400 },
    );
  }

  // Hash file contents with SHA-256 to deduplicate uploads
  const fileBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", fileBuffer);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0")) // since 0-15 in hex is 0-f and we want it to always be 2 chars so pad with 0
    .join("");

  const ext = file.name.toLowerCase().endsWith(".midi") ? ".midi" : ".mid";
  const storagePath = `${userId}/uploads/${hashHex}${ext}`;

  // Upload to Supabase Storage (upsert: false will error if the file already exists)
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(MIDI_BUCKET)
    .upload(storagePath, new Blob([fileBuffer], { type: "audio/midi" }), {
      contentType: "audio/midi",
      upsert: false,
      cacheControl: "3153600000", // 1 year in seconds since this file is immutable (hash-based name)
    });

  if (uploadError) {
    console.error("Storage upload error:", uploadError);
    return Response.json(
      { error: `Upload failed: ${uploadError.message}` },
      { status: uploadError.statusCode ? +uploadError.statusCode : 500 },
    );
  }

  // Insert a row in the scores table with just the storage path
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const scoreId = crypto.randomUUID();
  const { error: scoreError } = await supabase.from(SCORES_TABLE).insert({
    id: scoreId,
    user_id: userId,
    title: safeName,
    file_path: uploadData.path,
  });

  if (scoreError) {
    console.error("Score insert error:", scoreError);
    return Response.json(
      { error: "Failed to save score record" },
      { status: 500 },
    );
  }

  return Response.json({ scoreId }, { status: 201 });
}
