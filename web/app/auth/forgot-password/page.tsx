import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { notFound } from "next/navigation";

export default function Page() {
  return notFound();

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
