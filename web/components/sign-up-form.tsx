"use client";

import { cn } from "@/lib/utils";
import { signUp, signInWithGoogle } from "@/lib/better-auth/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronLeft } from "lucide-react";

export function SignUpForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSignUp = async (e: React.SubmitEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await signUp(email, password);
      if (error) throw error;

      router.push("/dashboard");
      // Uncomment below line if we ever add email verification and remove the redirect to /dashboard
      // router.push("/auth/sign-up-success");
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    await signInWithGoogle();
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Link
        href="/"
        className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-pink-400 transition-colors self-start"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to home
      </Link>

      <Card className="rounded-[2.5rem] border-pink-100 shadow-xl bg-white/90 backdrop-blur-sm px-4 py-6">
        <CardHeader className="text-center">
          {/* Tabs UI to match Login */}
          <div className="flex bg-[#F3F0F5] rounded-full p-1 mb-6 w-full max-w-[280px] mx-auto">
            <Link
              href="/auth/login"
              className="flex-1 py-2 px-4 rounded-full text-sm font-medium text-gray-500 hover:text-gray-700"
            >
              Log in
            </Link>
            <button className="flex-1 py-2 px-4 rounded-full bg-pink-200 text-sm font-medium">
              Sign up
            </button>
          </div>

          <CardTitle className="text-3xl font-serif text-[#2D3142]">
            Create Account
          </CardTitle>
          <CardDescription className="text-slate-500">
            Start your musical journey today
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSignUp}>
            <div className="flex flex-col gap-5">
              <div className="grid gap-2">
                <Label htmlFor="email" className="text-sm font-semibold ml-1">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  className="rounded-xl bg-[#FFF9F9] border-pink-50 h-12"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label
                  htmlFor="password"
                  className="text-sm font-semibold ml-1"
                >
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Create a password (6+ characters)"
                  className="rounded-xl bg-[#FFF9F9] border-pink-50 h-12"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {error && (
                <p className="text-xs text-red-400 text-center">{error}</p>
              )}

              <Button
                type="submit"
                className="w-full h-12 rounded-xl bg-[#4A4E69] hover:bg-[#3D405B] text-white font-bold transition-all shadow-md mt-2"
                disabled={isLoading}
              >
                {isLoading ? "Creating..." : "✿ Sign Up"}
              </Button>

              <div className="relative my-2">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-pink-100" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-2 text-slate-400">Or</span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full h-12 rounded-xl border-slate-200 hover:bg-slate-50 flex gap-2 items-center justify-center transition-all"
                onClick={handleGoogleLogin}
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                Sign up with Google
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
