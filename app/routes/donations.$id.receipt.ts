import { eq } from "drizzle-orm";
import type { Route } from "./+types/donations.$id.receipt";
import { getDb, schema } from "../db";
import { getAccess } from "../lib/access.server";

/** Gift receipts are private: the giver, and the people who see the fellowship's money. */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const db = getDb(env.DB);
  const { user, manageDues } = await getAccess(request, env, db);
  const row = await db
    .select({ key: schema.donations.receiptKey, ownerUserId: schema.members.userId })
    .from(schema.donations)
    .leftJoin(schema.members, eq(schema.members.id, schema.donations.memberId))
    .where(eq(schema.donations.id, params.id))
    .get();
  if (!row) throw new Response("Not found", { status: 404 });
  if (row.ownerUserId !== user.id && !manageDues) throw new Response("Forbidden", { status: 403 });
  const obj = await env.MEDIA.get(row.key);
  if (!obj) throw new Response("Not found", { status: 404 });
  return new Response(obj.body, {
    headers: { "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
  });
}
