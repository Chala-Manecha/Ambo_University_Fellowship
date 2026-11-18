import { desc, eq } from "drizzle-orm";
import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/songs-manage";
import { getDb, schema } from "../db";
import { getAccess } from "../lib/access.server";
import { canManageSongs } from "../lib/departments";
import { audioExt, checkAudio } from "../lib/songs";

export function meta() {
  return [{ title: "Songs · Gibi Gubae" }];
}

async function guard(request: Request, env: Env) {
  const db = getDb(env.DB);
  const { user, leaderOf } = await getAccess(request, env, db);
  if (!canManageSongs(user.role, leaderOf)) throw new Response("Only መዝሙር ክፍል manages songs.", { status: 403 });
  return { db, user };
}

/** መዝሙር ክፍል: add songs (title, words, optional recording) and release them to members. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = await guard(request, context.cloudflare.env);
  const songs = await db
    .select({ id: schema.songs.id, title: schema.songs.title, body: schema.songs.body, hasAudio: schema.songs.audioKey, released: schema.songs.released })
    .from(schema.songs)
    .orderBy(desc(schema.songs.createdAt));
  return { songs: songs.map((s) => ({ ...s, hasAudio: Boolean(s.hasAudio) })) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const { db, user } = await guard(request, env);
  const form = await request.formData();
  const intent = form.get("intent");
  const id = String(form.get("id") ?? "");

  if (intent === "release" || intent === "unrelease") {
    await db.update(schema.songs).set({ released: intent === "release" }).where(eq(schema.songs.id, id));
    return { message: intent === "release" ? "Released: members can see it now." : "Hidden from members." };
  }
  if (intent === "delete") {
    const s = await db.query.songs.findFirst({ where: eq(schema.songs.id, id), columns: { audioKey: true } });
    await db.delete(schema.songs).where(eq(schema.songs.id, id));
    if (s?.audioKey) await env.MEDIA.delete(s.audioKey);
    return { message: "Song deleted." };
  }

  // Add, or edit an existing song (a new recording replaces the old one)
  const title = String(form.get("title") ?? "").trim().slice(0, 150);
  const body = String(form.get("body") ?? "").trim().slice(0, 20_000);
  if (title.length < 2) return { error: "Enter the song's title." };
  if (body.length < 2) return { error: "Enter the words of the song." };
  const audio = checkAudio(form.get("audio"));
  if (!audio.ok) return { error: audio.error };
  const songId = id || crypto.randomUUID();
  let audioKey: string | undefined;
  if (audio.file) {
    audioKey = `songs/${songId}-${Date.now().toString(36)}.${audioExt(audio.file.type)}`;
    await env.MEDIA.put(audioKey, audio.file.stream(), { httpMetadata: { contentType: audio.file.type } });
  }
  if (id) {
    const old = await db.query.songs.findFirst({ where: eq(schema.songs.id, id), columns: { audioKey: true } });
    if (!old) return { error: "That song no longer exists." };
    await db
      .update(schema.songs)
      .set({ title, body, ...(audioKey ? { audioKey, audioType: audio.file!.type } : {}) })
      .where(eq(schema.songs.id, id));
    if (audioKey && old.audioKey) await env.MEDIA.delete(old.audioKey);
    return { message: "Saved." };
  }
  await db.insert(schema.songs).values({ id: songId, title, body, audioKey: audioKey ?? null, audioType: audio.file?.type ?? null, createdBy: user.id });
  return { message: `Added “${title}”. Release it when it's ready for members.` };
}

function SongFields({ title = "", body = "", hasAudio = false }: { title?: string; body?: string; hasAudio?: boolean }) {
  return (
    <>
      <label className="field"><span>Title</span><input name="title" required maxLength={150} defaultValue={title} /></label>
      <label className="field"><span>Words</span><textarea name="body" required rows={10} maxLength={20000} defaultValue={body} /></label>
      <label className="field">
        <span>Recording <small>{hasAudio ? "Optional — choose a file to replace the current one" : "Optional · MP3 or M4A, up to 20 MB"}</small></span>
        <input type="file" name="audio" accept="audio/*" />
      </label>
    </>
  );
}

export default function SongsManage({ loaderData, actionData }: Route.ComponentProps) {
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const uploading = nav.state === "submitting" && nav.formEncType === "multipart/form-data";
  const { songs } = loaderData;
  const message = actionData && "message" in actionData ? actionData.message : null;
  const error = actionData && "error" in actionData ? actionData.error : null;

  return (
    <section className="page wide">
      {message && <p className="notice" role="status">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <details className="card add-panel" open={songs.length === 0}>
        <summary>＋ Add a song</summary>
        <Form method="post" encType="multipart/form-data" className="form">
          <SongFields />
          <button className="btn btn-primary btn-sm" disabled={busy}>{uploading ? "Uploading…" : "Add song"}</button>
        </Form>
      </details>

      <div className="card table-card">
        <div className="table-bar">
          <strong>{songs.length} song{songs.length === 1 ? "" : "s"} · {songs.filter((s) => s.released).length} released</strong>
          <Link to="/songs" className="btn btn-quiet btn-sm">👁 Members' view</Link>
        </div>
        {songs.length === 0 ? (
          <p className="muted table-empty">No songs yet.</p>
        ) : (
          <ul className="song-admin">
            {songs.map((s) => (
              <li key={s.id}>
                <div className="song-admin-row">
                  <span><strong>{s.title}</strong> {s.hasAudio && <span title="Has a recording">🎧</span>}</span>
                  <span className={`pill ${s.released ? "pill-active" : "pill-pending"}`}>{s.released ? "Released" : "Draft"}</span>
                  <Form method="post" preventScrollReset>
                    <input type="hidden" name="id" value={s.id} />
                    <button name="intent" value={s.released ? "unrelease" : "release"} className={`btn btn-sm ${s.released ? "btn-quiet" : "btn-primary"}`} disabled={busy}>
                      {s.released ? "Hide" : "Release"}
                    </button>
                  </Form>
                </div>
                <details className="song-edit">
                  <summary>Edit</summary>
                  <Form method="post" encType="multipart/form-data" className="form">
                    <input type="hidden" name="id" value={s.id} />
                    <SongFields title={s.title} body={s.body} hasAudio={s.hasAudio} />
                    <div className="row-actions">
                      <button className="btn btn-primary btn-sm" disabled={busy}>Save</button>
                    </div>
                  </Form>
                  <Form method="post" preventScrollReset onSubmit={(e) => { if (!window.confirm(`Delete “${s.title}”?`)) e.preventDefault(); }}>
                    <input type="hidden" name="id" value={s.id} />
                    <button name="intent" value="delete" className="link-btn danger-link" disabled={busy}>Delete this song</button>
                  </Form>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
