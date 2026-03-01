// This file creates a Supabase client that bypasses RLS so this client is best used on the server side routes without needing Supabase Auth
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}
