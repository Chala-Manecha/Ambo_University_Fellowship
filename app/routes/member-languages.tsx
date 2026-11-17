import { eq } from "drizzle-orm";
import { Form, useSearchParams } from "react-router";
import type { Route } from "./+types/member-languages";
import { Counts } from "../components/Panel";
import { getDb, schema } from "../db";
import { getAccess } from "../lib/access.server";
import { matchesSearch, pickParam } from "../lib/dashboard";
import { canSeeLanguages } from "../lib/departments";
import { formatYear } from "../lib/registration";

export function meta() {
  return [{ title: "Members by language · Gibi Gubae" }];
}

/** ቋንቋ እና ልዩ ፍላጎት: who prefers teaching and messages in Afaan Oromoo or Amharic. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const db = getDb(env.DB);
  const { user, leaderOf } = await getAccess(request, env, db);
  if (!canSeeLanguages(user.role, leaderOf)) throw new Response("You don't have access to this page.", { status: 403 });
  const rows = await db
    .select({
      id: schema.members.id,
      fullName: schema.members.fullName,
      studentId: schema.members.studentId,
      gender: schema.members.gender,
      fieldOfStudy: schema.members.fieldOfStudy,
      yearOfStudy: schema.members.yearOfStudy,
      phone: schema.members.phone,
      language: schema.members.contentLanguage,
      telegramUsername: schema.user.telegramUsername,
    })
    .from(schema.members)
    .innerJoin(schema.user, eq(schema.user.id, schema.members.userId))
    .where(eq(schema.members.status, "active"))
    .orderBy(schema.members.fullName);
  return { rows };
}

const LANG_NAME = { om: "Afaan Oromoo", am: "አማርኛ" } as const;

export default function MemberLanguages({ loaderData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const lang = pickParam(params.get("language"), ["om", "am"] as const);
  const searched = loaderData.rows.filter((r) => matchesSearch(q, [r.fullName, r.studentId, r.phone, r.telegramUsername]));
  const rows = searched.filter((r) => !lang || r.language === lang);
  const href = (v: string | null) => {
    const p = new URLSearchParams(params);
    if (v) p.set("language", v);
    else p.delete("language");
    return `?${p.toString()}`;
  };

  return (
    <section className="page wide">
      <Counts
        items={[
          { to: href(null), n: searched.length, label: "All", active: !lang },
          { to: href("om"), n: searched.filter((r) => r.language === "om").length, label: LANG_NAME.om, active: lang === "om" },
          { to: href("am"), n: searched.filter((r) => r.language === "am").length, label: LANG_NAME.am, active: lang === "am" },
        ]}
      />
      <Form method="get" className="card filter-bar" role="search">
        {lang && <input type="hidden" name="language" value={lang} />}
        <input type="search" name="q" defaultValue={q} placeholder="🔍 Name, ID, phone, @telegram" aria-label="Search" className="filter-q" />
      </Form>
      <div className="card table-card">
        <div className="table-bar">
          <strong>{rows.length} {rows.length === 1 ? "member" : "members"}</strong>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => window.print()}>🖨️ Print</button>
        </div>
        {rows.length === 0 ? (
          <p className="muted table-empty">Nobody matches.</p>
        ) : (
          <div className="table-wrap">
            <table className="table-oneline">
              <thead><tr><th>Member</th><th>Language</th><th>Gender</th><th>Study</th><th>Phone</th><th>Telegram</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.fullName}</strong><span className="who-id">{r.studentId}</span></td>
                    <td lang={r.language}><span className="tag">{LANG_NAME[r.language]}</span></td>
                    <td>{r.gender === "male" ? "M" : "F"}</td>
                    <td>{r.fieldOfStudy} · {formatYear(r.yearOfStudy)}</td>
                    <td>{r.phone ? <a href={`tel:${r.phone}`}>{r.phone}</a> : "—"}</td>
                    <td>{r.telegramUsername ? <a href={`https://t.me/${r.telegramUsername}`} target="_blank" rel="noreferrer">@{r.telegramUsername}</a> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
