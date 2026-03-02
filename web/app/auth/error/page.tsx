import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { Suspense } from "react";

async function ErrorContent({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>;
}) {
  const params = await searchParams;

  return (
    <>
      {params?.error ? (
        <p className="text-sm text-muted-foreground">
          Code error: {params.error}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          An unspecified error occurred.
        </p>
      )}
    </>
  );
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>;
}) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">
                Sorry, something went wrong.
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Suspense>
                <ErrorContent searchParams={searchParams} />
              </Suspense>
              <Button asChild className="w-full">
                <Link href="/auth/login">Back to Login</Link>
              </Button>
              <Link
                href="https://forms.gle/EJqinZh2knDvv4ck7"
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-10 rounded-full bg-white/60 px-4 text-sakura-dark/70 hover:bg-white hover:text-sakura-text-pink transition-colors text-sm font-medium shadow hover:bg-primary/90 items-center justify-center text-center w-full"
              >
                Report Issue
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
