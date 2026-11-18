import { eq } from "drizzle-orm";
import type { Route } from "./+types/songs.$id.audio";
import { getDb, schema } from "../db";
import { getAccess } from "../lib/access.server";
import { canManageSongs } from "../lib/departments";

/** Streams a song's recording from R2, with Range support so the player can seek. */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const db = getDb(env.DB);
  const { user, leaderOf } = await getAccess(request, env, db);
  const song = await db.query.songs.findFirst({ where: eq(schema.songs.id, params.id), columns: { audioKey: true, audioType: true, released: true } });
  if (!song?.audioKey || (!song.released && !canManageSongs(user.role, leaderOf))) throw new Response("Not found", { status: 404 });

  const obj = await env.MEDIA.get(song.audioKey, { range: request.headers });
  if (!obj) throw new Response("Not found", { status: 404 });
  const headers = new Headers({
    "Content-Type": song.audioType ?? obj.httpMetadata?.contentType ?? "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  });
  const range = obj.range as { offset?: number; length?: number } | undefined;
  if (request.headers.has("Range") && range && typeof range.offset === "number") {
    const length = range.length ?? obj.size - range.offset;
    headers.set("Content-Range", `bytes ${range.offset}-${range.offset + length - 1}/${obj.size}`);
    headers.set("Content-Length", String(length));
    return new Response((obj as R2ObjectBody).body, { status: 206, headers });
  }
  headers.set("Content-Length", String(obj.size));
  return new Response((obj as R2ObjectBody).body, { headers });
}
