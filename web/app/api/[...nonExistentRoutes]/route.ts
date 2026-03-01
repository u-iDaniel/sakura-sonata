import { NextResponse } from "next/server";

const notFound = () =>
  NextResponse.json({ error: "Not Found" }, { status: 404 });

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const OPTIONS = notFound;
