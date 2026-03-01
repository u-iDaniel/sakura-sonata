import { auth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/bypass-client";
import { SCORES_TABLE } from "@/lib/supabase/constants";
import { toMidiBucketPublicUrl } from "@/lib/supabase/utils";
import { headers } from "next/headers";

export async function GET() {
  const supabase = createClient();
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session || !session.user || !session.session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from(SCORES_TABLE)
    .select("id,title,file_path,created_at,user_id")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching scores:", error);
    return Response.json({ error: "Failed to fetch scores" }, { status: 500 });
  }

  // Convert storage paths to public URLs for client
  const scoresWithUrls = (data ?? []).map((score) => ({
    ...score,
    file_path: score.file_path ? toMidiBucketPublicUrl(score.file_path) : null,
  }));

  return Response.json(scoresWithUrls); // automatically returns 200 status
}
