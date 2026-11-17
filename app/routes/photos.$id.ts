import { eq } from "drizzle-orm";
import type { Route } from "./+types/photos.$id";
import { getDb, schema } from "../db";
import { getAccess } from "../lib/access.server";

/** A member's photo: the member themself, people who see the members list, and department leaders. */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const db = getDb(env.DB);
  const { user, leaderOf, listMembers } = await getAccess(request, env, db);
  const m = await db.query.members.findFirst({ where: eq(schema.members.id, params.id), columns: { userId: true, photoKey: true } });
  if (!m?.photoKey) throw new Response("Not found", { status: 404 });
  if (m.userId !== user.id && !listMembers && leaderOf.length === 0 && user.role !== "admin") throw new Response("Forbidden", { status: 403 });
  const obj = await env.MEDIA.get(m.photoKey);
  if (!obj) throw new Response("Not found", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "image/webp",
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
