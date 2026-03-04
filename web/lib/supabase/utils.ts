import { createClient } from "./bypass-client";
import { MIDI_BUCKET } from "./constants";

export function toStoragePath(fileUrlOrPath: string) {
  if (!fileUrlOrPath.startsWith("http")) return fileUrlOrPath;
  const publicMarker = `/storage/v1/object/public/${MIDI_BUCKET}/`;
  let idx = fileUrlOrPath.indexOf(publicMarker);
  if (idx >= 0) return fileUrlOrPath.slice(idx + publicMarker.length);
  return "";
}

/**
 * Converts a storage path to a public URL
 * @param storagePath - The relative path in the storage bucket (e.g., "userId/uploads/hash.mid")
 * @returns The full public URL to access the file
 * @deprecated No longer used as switched to a private bucket
 */
export function toMidiBucketPublicUrl(storagePath: string): string {
  const supabase = createClient();
  const { data } = supabase.storage.from(MIDI_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}
