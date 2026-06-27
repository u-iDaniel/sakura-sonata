import { auth } from "@/lib/auth";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (
    request.nextUrl.pathname !== "/" &&
    request.nextUrl.pathname !== "/api/health" &&
    !session?.user &&
    !request.nextUrl.pathname.startsWith("/auth") &&
    !request.nextUrl.pathname.startsWith("/api/auth")
  ) {
    // API routes get a 401 JSON response; pages get redirected to login
    if (request.nextUrl.pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    return NextResponse.redirect(url);
  }

  if (
    session?.user &&
    (request.nextUrl.pathname === "/auth/login" ||
      request.nextUrl.pathname === "/auth/sign-up")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return NextResponse.next({
    request,
  });
}
