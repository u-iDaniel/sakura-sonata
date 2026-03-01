// This file is for the general client side sign up, login, and logout functions. For better-auth configuration details, see `@/lib/auth` and `@/lib/auth-client`
import { authClient } from "@/lib/auth-client";

export async function signUp(email: string, password: string) {
  const { data, error } = await authClient.signUp.email(
    {
      email,
      password,
      name: email,
      callbackURL: "/dashboard", // use later on when we add email verification (this redirects the user after they click the verification link in their email)
    },
    {
      // Can add onRequest(ctx), onSuccess(ctx), onError(ctx) methods here if needed
    },
  );

  return { data, error };
}

export async function signInWithPassword(email: string, password: string) {
  const { data, error } = await authClient.signIn.email({
    email,
    password,
  });

  return { data, error };
}

export async function signInWithGoogle() {
  const { data, error } = await authClient.signIn.social({
    provider: "google",
    callbackURL: "/dashboard",
    errorCallbackURL: "/auth/error",
  });

  return { data, error };
}

export async function signOut() {
  const { error } = await authClient.signOut();
  return { error };
}
