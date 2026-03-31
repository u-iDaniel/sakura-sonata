import { auth } from "@/lib/auth";
import { fetchInternalApi } from "@/lib/internal-api";
import { headers } from "next/headers";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXTENSIONS = [".mid", ".midi"];

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
      "/v1/storage/midi",
      { method: "GET" },
      query,
    );

    return new Response(backendResponse.body, {
      status: backendResponse.status,
      headers: backendResponse.headers,
    });
  } catch (error) {
    console.error("Error downloading MIDI from backend:", error);
    return Response.json(
      { error: "Failed to call internal backend" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
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

  const query = new URLSearchParams({
    userId,
    filePath: storagePath,
  });

  const passThroughFormData = new FormData();
  passThroughFormData.append("file", file);

  try {
    const backendResponse = await fetchInternalApi(
      "/v1/storage/midi",
      {
        method: "POST",
        body: passThroughFormData,
      },
      query,
    );

    return new Response(backendResponse.body, {
      status: backendResponse.status,
      headers: backendResponse.headers,
    });
  } catch (error) {
    console.error("Error uploading MIDI to backend:", error);
    return Response.json(
      { error: "Failed to call internal backend" },
      { status: 500 },
    );
  }
}
