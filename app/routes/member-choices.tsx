import { Fragment, useState } from "react";
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
  const serveNone = params.get("serve") === "none";
  const learnNone = params.get("learn") === "none";
  const rows = searched.filter(
    (r) =>
      (serveNone ? r.services.length === 0 && !r.otherService : !serve || r.services.includes(serve)) &&
      (learnNone ? r.learning.length === 0 : !learn || r.learning.includes(learn)),
  );
  const serveCount = (k: string) => searched.filter((r) => r.services.includes(k) && (!learn || r.learning.includes(learn))).length;
  const learnCount = (k: string) => searched.filter((r) => r.learning.includes(k) && (!serve || r.services.includes(serve))).length;
  const submitOnChange = (e: React.ChangeEvent<HTMLSelectElement>) => e.currentTarget.form?.requestSubmit();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <section className="page wide">
      <Form method="get" className="card filter-bar" role="search">
        <input type="search" name="q" defaultValue={q} placeholder="🔍 Name or student ID" aria-label="Search" className="filter-q" />
        <select name="serve" defaultValue={serveNone ? "none" : serve ?? ""} onChange={submitOnChange} aria-label="Wants to serve in" lang={lang}>
          <option value="">Wants to serve: any</option>
          <option value="none">Nothing chosen</option>
          {SERVICE_KEYS.map((k) => <option key={k} value={k}>{SERVICES[k][lang]} ({serveCount(k)})</option>)}
        </select>
        <select name="learn" defaultValue={learnNone ? "none" : learn ?? ""} onChange={submitOnChange} aria-label="Wants to learn" lang={lang}>
          <option value="">Wants to learn: any</option>
          <option value="none">Nothing chosen</option>
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
            <table className="table-oneline choices-compact">
              <thead><tr><th>Member</th><th className="num">Serve</th><th className="num">Learn</th><th><span className="visually-hidden">Details</span></th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const open = openId === r.id;
                  const serveTags = [...r.services.filter((k) => k in SERVICES).map((k) => ({ k, label: SERVICES[k as keyof typeof SERVICES][lang] })), ...(r.otherService ? [{ k: "other", label: r.otherService }] : [])];
                  const learnTags = r.learning.filter((k) => k in LEARNING).map((k) => ({ k, label: LEARNING[k as keyof typeof LEARNING][lang] }));
                  return (
                    <Fragment key={r.id}>
                      <tr>
                        <td><strong>{r.fullName}</strong><span className="who-id">{r.studentId}</span></td>
                        <td className="num">{serveTags.length}</td>
                        <td className="num">{learnTags.length}</td>
                        <td>
                          <button type="button" className="btn btn-quiet btn-sm" aria-expanded={open} onClick={() => setOpenId(open ? null : r.id)}>
                            {open ? "Hide" : "View"}
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr className="choices-detail">
                          <td colSpan={4} lang={lang}>
                            <p><b>Wants to serve:</b> {serveTags.length ? <span className="tags">{serveTags.map((t) => <span key={t.k} className={`tag${t.k === serve ? " is-on" : ""}`}>{t.label}</span>)}</span> : <span className="muted">nothing chosen</span>}</p>
                            <p><b>Wants to learn:</b> {learnTags.length ? <span className="tags">{learnTags.map((t) => <span key={t.k} className={`tag${t.k === learn ? " is-on" : ""}`}>{t.label}</span>)}</span> : <span className="muted">nothing chosen</span>}</p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
