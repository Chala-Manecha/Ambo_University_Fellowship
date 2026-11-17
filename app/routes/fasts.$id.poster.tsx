import { eq } from "drizzle-orm";
import { Link } from "react-router";
import { renderSVG } from "uqr";
import type { Route } from "./+types/fasts.$id.poster";
import { HOME } from "../content/site";
import { getDb, schema } from "../db";
import { formatEc } from "../lib/ethiopian-date";
import { FAST_TYPE_LABELS, FAST_TYPES } from "../lib/fasts";
import { requirePermission } from "../lib/session.server";

export function meta() {
  return [{ title: "Fast poster · Gibi Gubae" }];
}

/** A printable A4 poster with a QR code that opens the fast's registration page. */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  await requirePermission(request, env, "fast:manage");
  const fast = await getDb(env.DB).query.fasts.findFirst({ where: eq(schema.fasts.id, params.id) });
  if (!fast) throw new Response("Fast not found", { status: 404 });
  const url = `${env.PUBLIC_SITE_URL}/fasts/${fast.id}/join`;
  return { fast, url, qrSvg: renderSVG(url, { border: 2, ecc: "M" }) };
}

export default function Poster({ loaderData }: Route.ComponentProps) {
  const { fast, url, qrSvg } = loaderData;
  return (
    <section className="poster">
      <p className="no-print muted">
        <Link to={`/fasts/${fast.id}`}>← Back</Link> · <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>🖨 Print</button>
      </p>
      <p className="poster-org" lang="am">{HOME.am.header}</p>
      <p className="poster-org" lang="om">{HOME.om.header}</p>
      <h1 className="poster-title">{fast.name}</h1>
      <p className="poster-dates">
        <span lang="am">{formatEc(fast.startDate, "am")} – {formatEc(fast.endDate, "am")}</span>
      </p>
      <div className="poster-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
      <p className="poster-cta" lang="am">ለጾም ምግብ ለመመዝገብ ይህን QR በስልክዎ ካሜራ ይቃኙ</p>
      <p className="poster-cta" lang="om">Nyaata soomaatiif galmaa'uuf QR kana kaameraa bilbilaa keessaniin iskaanii godhaa</p>
      <ul className="poster-types">
        {FAST_TYPES.map((t) => (
          <li key={t}><span lang="am">{FAST_TYPE_LABELS[t].am}</span> / <span lang="om">{FAST_TYPE_LABELS[t].om}</span></li>
        ))}
      </ul>
      <p className="poster-url">{url}</p>
    </section>
  );
}
