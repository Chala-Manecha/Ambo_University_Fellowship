import { Form, useRouteLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/member-choices";
import type { loader as rootLoader } from "../root";
import { LEARNING, LEARNING_KEYS, SERVICE_KEYS, SERVICES } from "../content/member-options";
import { getDb } from "../db";
import { requireMemberList } from "../lib/access.server";
import { matchesSearch, pickParam } from "../lib/dashboard";
import { DEFAULT_LANG } from "../lib/lang";
import { loadMemberList } from "../lib/members.server";

export function meta() {
  return [{ title: "Members' choices · Gibi Gubae" }];
}

/** What each active member chose at registration: where they'd serve and what they'd learn. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const db = getDb(env.DB);
  await requireMemberList(request, env, db);
  const all = await loadMemberList(db);
  return {
    rows: all
      .filter((m) => m.status === "active")
      .map((m) => ({ id: m.id, fullName: m.fullName, studentId: m.studentId, services: m.services ?? [], otherService: m.otherService, learning: m.learning ?? [] })),
  };
}

export default function MemberChoices({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const serve = pickParam(params.get("serve"), SERVICE_KEYS);
  const learn = pickParam(params.get("learn"), LEARNING_KEYS);
  const searched = loaderData.rows.filter((r) => matchesSearch(q, [r.fullName, r.studentId]));
  const rows = searched.filter((r) => (!serve || r.services.includes(serve)) && (!learn || r.learning.includes(learn)));
  const serveCount = (k: string) => searched.filter((r) => r.services.includes(k) && (!learn || r.learning.includes(learn))).length;
  const learnCount = (k: string) => searched.filter((r) => r.learning.includes(k) && (!serve || r.services.includes(serve))).length;
  const submitOnChange = (e: React.ChangeEvent<HTMLSelectElement>) => e.currentTarget.form?.requestSubmit();

  return (
    <section className="page wide">
      <Form method="get" className="card filter-bar" role="search">
        <input type="search" name="q" defaultValue={q} placeholder="🔍 Name or student ID" aria-label="Search" className="filter-q" />
        <select name="serve" defaultValue={serve ?? ""} onChange={submitOnChange} aria-label="Wants to serve in" lang={lang}>
          <option value="">Serve: all</option>
          {SERVICE_KEYS.map((k) => <option key={k} value={k}>{SERVICES[k][lang]} ({serveCount(k)})</option>)}
        </select>
        <select name="learn" defaultValue={learn ?? ""} onChange={submitOnChange} aria-label="Wants to learn" lang={lang}>
          <option value="">Learn: all</option>
          {LEARNING_KEYS.map((k) => <option key={k} value={k}>{LEARNING[k][lang]} ({learnCount(k)})</option>)}
        </select>
        <button className="btn btn-primary btn-sm">Filter</button>
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
            <table className="choices-table">
              <thead><tr><th>Member</th><th>Wants to serve</th><th>Wants to learn</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.fullName}</strong><span className="who-id">{r.studentId}</span></td>
                    <td lang={lang}>
                      {r.services.length || r.otherService ? (
                        <span className="tags">
                          {r.services.filter((k) => k in SERVICES).map((k) => <span key={k} className={`tag${k === serve ? " is-on" : ""}`}>{SERVICES[k as keyof typeof SERVICES][lang]}</span>)}
                          {r.otherService && <span className="tag">{r.otherService}</span>}
                        </span>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td lang={lang}>
                      {r.learning.length ? (
                        <span className="tags">
                          {r.learning.filter((k) => k in LEARNING).map((k) => <span key={k} className={`tag${k === learn ? " is-on" : ""}`}>{LEARNING[k as keyof typeof LEARNING][lang]}</span>)}
                        </span>
                      ) : <span className="muted">—</span>}
                    </td>
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
