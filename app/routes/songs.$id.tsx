import { and, eq } from "drizzle-orm";
import { Link } from "react-router";
import type { Route } from "./+types/songs.$id";
import { getDb, schema } from "../db";
import { requireUser } from "../lib/session.server";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.song.title ?? "Song"} · Gibi Gubae` }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  await requireUser(request, context.cloudflare.env);
  const song = await getDb(context.cloudflare.env.DB).query.songs.findFirst({
    where: and(eq(schema.songs.id, params.id), eq(schema.songs.released, true)),
    columns: { id: true, title: true, body: true, audioKey: true },
  });
  if (!song) throw new Response("Song not found", { status: 404 });
  return { song: { id: song.id, title: song.title, body: song.body, hasAudio: Boolean(song.audioKey) } };
}

export default function Song({ loaderData }: Route.ComponentProps) {
  const { song } = loaderData;
  return (
    <section className="page narrow">
      <p className="muted"><Link to="/songs">← All songs</Link></p>
      <h1 className="song-title">{song.title}</h1>
      {song.hasAudio && <audio className="song-audio" controls preload="none" src={`/songs/${song.id}/audio`} />}
      <div className="card song-body">{song.body}</div>
    </section>
  );
}
