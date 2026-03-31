import { auth } from "@/lib/auth";
import { fetchInternalApi } from "@/lib/internal-api";
import { headers } from "next/headers";

export async function GET() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session || !session.user || !session.session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const query = new URLSearchParams({ userId: session.user.id });

  try {
    const backendResponse = await fetchInternalApi(
      "/v1/music/scores",
      { method: "GET" },
      query,
    );

    return new Response(backendResponse.body, {
      status: backendResponse.status,
      headers: backendResponse.headers,
    });
  } catch (error) {
    console.error("Error fetching scores from backend:", error);
    return Response.json(
      { error: "Failed to call internal backend" },
      { status: 500 },
    );
  }
}
