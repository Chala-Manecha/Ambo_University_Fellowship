export const AUDIO_TYPES = ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/ogg", "audio/webm", "audio/wav", "audio/x-wav", "audio/opus"] as const;
/** Kept well under the Workers upload limit; a 5-minute song as MP3 is about 5 MB. */
export const AUDIO_MAX_BYTES = 20 * 1024 * 1024;

export function checkAudio(file: unknown): { ok: true; file: File | null } | { ok: false; error: string } {
  if (!(file instanceof File) || file.size === 0) return { ok: true, file: null }; // audio is optional
  if (!(AUDIO_TYPES as readonly string[]).includes(file.type)) return { ok: false, error: "The recording must be an audio file (MP3, M4A, OGG, WAV)." };
  if (file.size > AUDIO_MAX_BYTES) return { ok: false, error: "The recording is too large (max 20 MB). Save it as MP3." };
  return { ok: true, file };
}

export function audioExt(type: string) {
  if (type === "audio/mpeg") return "mp3";
  if (type === "audio/ogg" || type === "audio/opus") return "ogg";
  if (type === "audio/webm") return "webm";
  if (type.includes("wav")) return "wav";
  return "m4a";
}
