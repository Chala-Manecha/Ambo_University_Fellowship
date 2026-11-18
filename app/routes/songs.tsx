import { asc, eq } from "drizzle-orm";
import { Form, Link, useSearchParams } from "react-router";
import type { Route } from "./+types/songs";
import { getDb, schema } from "../db";
import { matchesSearch } from "../lib/dashboard";
import { requireUser } from "../lib/session.server";

export function meta() {
  return [{ title: "Songs · Gibi Gubae" }];
}

/** Songs released by መዝሙር ክፍል, for every signed-in member. */
export async function loader({ request, context }: Route.LoaderArgs) {
  await requireUser(request, context.cloudflare.env);
  const songs = await getDb(context.cloudflare.env.DB)
    .select({ id: schema.songs.id, title: schema.songs.title, audio: schema.songs.audioKey })
    .from(schema.songs)
    .where(eq(schema.songs.released, true))
    .orderBy(asc(schema.songs.title));
  return { songs: songs.map((s) => ({ id: s.id, title: s.title, hasAudio: Boolean(s.audio) })) };
}

export default function Songs({ loaderData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const shown = loaderData.songs.filter((s) => matchesSearch(q, [s.title]));
  return (
    <section className="page narrow">
      <p className="muted"><Link to="/account">← My dashboard</Link></p>
      <h1>🎵 <span lang="am">መዝሙሮች</span> <small lang="om">/ Faarfannaa</small></h1>
      <Form method="get" className="card filter-bar" role="search">
        <input type="search" name="q" defaultValue={q} placeholder="🔍 Search a song" aria-label="Search" className="filter-q" />
      </Form>
      {shown.length === 0 ? (
        <p className="muted">{loaderData.songs.length ? "No song matches." : "No songs released yet."}</p>
      ) : (
        <ul className="song-list">
          {shown.map((s) => (
            <li key={s.id}>
              <Link to={`/songs/${s.id}`}>
                <span>{s.title}</span>
                {s.hasAudio && <span aria-label="Has a recording">🎧</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
