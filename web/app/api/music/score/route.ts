import { auth } from "@/lib/auth";
import { fetchInternalApi } from "@/lib/internal-api";
import { headers } from "next/headers";

export async function GET(request: Request) {
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

  const query = new URLSearchParams({
    id,
    userId: session.user.id,
  });

  try {
    const backendResponse = await fetchInternalApi(
      "/v1/music/score",
      { method: "GET" },
      query,
    );

    return new Response(backendResponse.body, {
      status: backendResponse.status,
      headers: backendResponse.headers,
    });
  } catch (error) {
    console.error("Error fetching score from backend:", error);
    return Response.json(
      { error: "Failed to call internal backend" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
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

  const query = new URLSearchParams({
    id,
    userId: session.user.id,
  });

  try {
    const backendResponse = await fetchInternalApi(
      "/v1/music/score",
      { method: "DELETE" },
      query,
    );

    return new Response(backendResponse.body, {
      status: backendResponse.status,
      headers: backendResponse.headers,
    });
  } catch (error) {
    console.error("Error deleting score from backend:", error);
    return Response.json(
      { error: "Failed to call internal backend" },
      { status: 500 },
    );
  }
}
