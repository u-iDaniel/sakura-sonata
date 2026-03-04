import { auth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/bypass-client";
import { MIDI_BUCKET, SCORES_TABLE } from "@/lib/supabase/constants";
import { toStoragePath } from "@/lib/supabase/utils";
import { headers } from "next/headers";

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

  const { data, error } = await supabase
    .from(SCORES_TABLE)
    .select("id, title")
    .eq("id", id)
    .eq("user_id", session.user.id)
    .single();

  if (error || !data) {
    console.error("Error fetching score:", error);
    return Response.json({ error: "Could not fetch score" }, { status: 500 });
  }

  return Response.json(data);
}

export async function DELETE(request: Request) {
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
    return Response.json({ error: "Score id is required" }, { status: 400 });
  }

  const { data: existingScore, error: fetchError } = await supabase
    .from(SCORES_TABLE)
    .select("id,file_path,user_id")
    .eq("id", id)
    .eq("user_id", session.user.id)
    .single();

  if (!existingScore) {
    return Response.json({ error: "Score not found" }, { status: 404 });
  }

  if (fetchError) {
    console.error("Error fetching score for deletion:", fetchError);
    return Response.json({ error: "Failed to find score" }, { status: 500 });
  }

  if (existingScore.user_id !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Delete the file from storage if it exists
  if (existingScore.file_path) {
    const { error: storageErr } = await supabase.storage
      .from(MIDI_BUCKET)
      .remove([existingScore.file_path]);

    if (storageErr) {
      console.error("Error deleting file from storage:", storageErr);
      return Response.json(
        { error: "Failed to delete associated file" },
        { status: 500 },
      );
    }
  }

  const { error: deleteError } = await supabase
    .from(SCORES_TABLE)
    .delete()
    .eq("id", id)
    .eq("user_id", session.user.id);

  if (deleteError) {
    console.error("Error deleting score:", deleteError);
    return Response.json({ error: "Failed to delete score" }, { status: 500 });
  }

  return new Response(null, { status: 204 });
}
