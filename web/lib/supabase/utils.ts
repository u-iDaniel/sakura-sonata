import { MIDI_BUCKET } from "./constants";

export function toStoragePath(fileUrlOrPath: string) {
  if (!fileUrlOrPath.startsWith("http")) return fileUrlOrPath;
  const publicMarker = `/storage/v1/object/public/${MIDI_BUCKET}/`;
  let idx = fileUrlOrPath.indexOf(publicMarker);
  if (idx >= 0) return fileUrlOrPath.slice(idx + publicMarker.length);
  return "";
}
