// This file creates a Supabase client that bypasses RLS so this client is best used on the server side routes without needing Supabase Auth
import { createClient as baseCreateClient } from "@supabase/supabase-js";

export function createClient() {
  return baseCreateClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}
