import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">404 - Page Not Found</CardTitle>
              <CardDescription>
                The page you&apos;re looking for doesn&apos;t exist or has been
                moved.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Button asChild className="w-full">
                <Link href="/">Go Home</Link>
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
