"use client";

import { signOut } from "@/lib/supabase/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

type LogoutButtonProps = {
  className?: string;
  label?: string;
};

export function LogoutButton({ className, label = "Logout" }: LogoutButtonProps) {
  const router = useRouter();

  const logout = async () => {
    await signOut();
    router.push("/auth/login");
  };

  return (
    <Button className={cn(className)} onClick={logout}>
      {label}
    </Button>
  );
}
