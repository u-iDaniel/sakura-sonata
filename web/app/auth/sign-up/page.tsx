import { SignUpForm } from "@/components/sign-up-form";
import { SakuraBackground } from "@/components/SakuraBackground";

export default function Page() {
  return (
    <>
      {/* 1. bg-[#FFF6EB] locks in the beige background color you requested.
        2. 'light' class prevents system dark mode from changing the theme.
        3. 'relative' and 'overflow-hidden' keep the floating petals contained.
      */}
      <main className="light min-h-screen w-full bg-[#FFF6EB] flex items-center justify-center relative overflow-hidden p-6 md:p-10">
        {/* Layer 1: Floating petals behind the form */}
        <div className="absolute inset-0 z-0 pointer-events-none">
          <SakuraBackground />
        </div>

        {/* Layer 2: The Sign-Up Form on top */}
        <div className="z-10 w-full max-w-sm">
          <SignUpForm />
        </div>
      </main>
    </>
  );
}
