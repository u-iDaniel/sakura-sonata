import Link from "next/link";

export function LandingPageHeader() {
  return (
    <header className="w-full flex justify-center px-4 pt-6">
      <div className="w-full max-w-5xl flex items-center justify-between rounded-full bg-white/70 backdrop-blur-sm px-4 sm:px-6 py-2.5 sm:py-3 shadow-sm">
        {/* Logo */}
        <Link
          href="/"
          className="font-fasthand text-xl sm:text-2xl text-sakura-text-pink select-none truncate"
        >
          Sakura Sonata
        </Link>

        {/* Auth Buttons */}
        <div className="flex items-center gap-2 sm:gap-3 ml-2">
          <Link
            href="/auth/login"
            className="rounded-full border border-sakura-pink px-3 sm:px-5 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-sakura-pink transition-colors hover:bg-sakura-pink/10 whitespace-nowrap"
          >
            Log in
          </Link>
          <Link
            href="/auth/sign-up"
            className="rounded-full bg-sakura-pink px-3 sm:px-5 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-white transition-colors hover:bg-sakura-pink/90 shadow-sm whitespace-nowrap"
          >
            Sign up
          </Link>
        </div>
      </div>
    </header>
  );
}
