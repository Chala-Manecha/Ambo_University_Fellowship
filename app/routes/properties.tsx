import { and, asc, eq } from "drizzle-orm";
import { Form, useNavigation, useRouteLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/properties";
import type { loader as rootLoader } from "../root";
import { Counts } from "../components/Panel";
import { getDb, schema } from "../db";
import { getAccess } from "../lib/access.server";
import { canAudit, canManageDepartment, departmentName, FINANCE_DEPT } from "../lib/departments";
import { DEFAULT_LANG } from "../lib/lang";

export function meta() {
  return [{ title: "Property · Gibi Gubae" }];
}

/**
 * Department property. ሂሳብ እና ንብረት (and admins) record it for every department; inside another
 * department's panel this shows only that department's things, read-only for its leader.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const db = getDb(env.DB);
  const { user, leaderOf, approveMoney } = await getAccess(request, env, db);
  const own = params.id && params.id !== FINANCE_DEPT ? params.id : null; // a department's own page
  if (own ? !canManageDepartment(user.role, leaderOf, own) && !approveMoney : !approveMoney && !canAudit(user.role, leaderOf)) {
    throw new Response("You don't have access to this page.", { status: 403 });
  }
  const [departments, items] = await Promise.all([
    db.query.departments.findMany({ orderBy: asc(schema.departments.sortOrder), columns: { id: true, nameOm: true, nameAm: true } }),
    db
      .select()
      .from(schema.properties)
      .where(own ? eq(schema.properties.departmentId, own) : undefined)
      .orderBy(asc(schema.properties.name)),
  ]);
  return {
    own,
    canEdit: approveMoney,
    departments,
    items: items.map((i) => ({ id: i.id, departmentId: i.departmentId, name: i.name, quantity: i.quantity, description: i.description, source: i.source })),
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const db = getDb(env.DB);
  const { user, approveMoney } = await getAccess(request, env, db);
  if (!approveMoney) return { message: "Only ሂሳብ እና ንብረት records property." };
  const form = await request.formData();
  if (form.get("intent") === "delete") {
    await db.delete(schema.properties).where(eq(schema.properties.id, String(form.get("id"))));
    return { message: "Removed." };
  }
  const own = params.id && params.id !== FINANCE_DEPT ? params.id : null;
  const departmentId = own ?? String(form.get("departmentId") ?? "");
  const dept = await db.query.departments.findFirst({ where: eq(schema.departments.id, departmentId), columns: { id: true } });
  const name = String(form.get("name") ?? "").trim().slice(0, 100);
  const quantity = Number(form.get("quantity"));
  const description = String(form.get("description") ?? "").trim().slice(0, 300) || null;
  const source = form.get("source") === "past_leaders" ? "past_leaders" : "new";
  if (!dept) return { message: "Choose the department." };
  if (name.length < 2) return { message: "Enter the item's name." };
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100_000) return { message: "Enter how many (a whole number)." };
  const id = String(form.get("id") ?? "");
  if (id) {
    await db.update(schema.properties).set({ departmentId, name, quantity, description, source }).where(and(eq(schema.properties.id, id)));
    return { message: "Saved." };
  }
  await db.insert(schema.properties).values({ departmentId, name, quantity, description, source, recordedBy: user.id });
  return { message: `Added: ${name}.` };
}

const SOURCE = { new: "New", past_leaders: "From past leaders" } as const;

export default function Properties({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const busy = useNavigation().state !== "idle";
  const [params] = useSearchParams();
  const { own, canEdit, departments, items } = loaderData;
  const deptName = (id: string) => {
    const d = departments.find((x) => x.id === id);
    return d ? departmentName(d, lang) : id;
  };
  const filter = own ?? params.get("dept");
  const shown = items.filter((i) => !filter || i.departmentId === filter);
  const href = (v: string | null) => {
    const p = new URLSearchParams(params);
    if (v) p.set("dept", v);
    else p.delete("dept");
    return `?${p.toString()}`;
  };

  return (
    <section className="page wide">
      {actionData?.message && <p className="notice" role="status">{actionData.message}</p>}
      {!own && (
        <Counts
          items={[
            { to: href(null), n: items.length, label: "All", active: !filter },
            ...departments
              .filter((d) => items.some((i) => i.departmentId === d.id))
              .map((d) => ({ to: href(d.id), n: items.filter((i) => i.departmentId === d.id).length, label: departmentName(d, lang), active: filter === d.id })),
          ]}
        />
      )}

      {canEdit && (
        <details className="card add-panel">
          <summary>＋ Add property</summary>
          <Form method="post" className="form">
            {!own && (
              <label className="field">
                <span>Department</span>
                <select name="departmentId" required defaultValue={filter ?? ""} lang={lang}>
                  <option value="" disabled>Choose…</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{departmentName(d, lang)}</option>)}
                </select>
              </label>
            )}
            <label className="field"><span>Name</span><input name="name" required maxLength={100} placeholder="e.g. Kebero (drum)" /></label>
            <label className="field"><span>Number</span><input name="quantity" type="number" min={1} defaultValue={1} required /></label>
            <label className="field"><span>Description <small>Optional</small></span><input name="description" maxLength={300} placeholder="condition, where it's kept…" /></label>
            <fieldset className="field">
              <legend>From</legend>
              <div className="choices">
                <label><input type="radio" name="source" value="new" defaultChecked /> New</label>
                <label><input type="radio" name="source" value="past_leaders" /> From past leaders</label>
              </div>
            </fieldset>
            <button className="btn btn-primary btn-sm" disabled={busy}>Add</button>
          </Form>
        </details>
      )}

      <div className="card table-card">
        <div className="table-bar">
          <strong>{shown.length} item{shown.length === 1 ? "" : "s"}</strong>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => window.print()}>🖨️ Print</button>
        </div>
        {shown.length === 0 ? (
          <p className="muted table-empty">{own ? "No property recorded for this department yet. ሂሳብ እና ንብረት records it." : "Nothing recorded yet."}</p>
        ) : (
          <div className="table-wrap">
            <table className="table-oneline">
              <thead><tr><th>Item</th><th className="num">Number</th>{!own && <th>Department</th>}<th>From</th>{canEdit && <th><span className="visually-hidden">Actions</span></th>}</tr></thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id}>
                    <td className="wrap"><strong>{i.name}</strong>{i.description && <span className="who-id">{i.description}</span>}</td>
                    <td className="num">{i.quantity}</td>
                    {!own && <td lang={lang}>{deptName(i.departmentId)}</td>}
                    <td>{SOURCE[i.source]}</td>
                    {canEdit && (
                      <td>
                        <Form method="post" preventScrollReset onSubmit={(e) => { if (!window.confirm(`Remove ${i.name}?`)) e.preventDefault(); }}>
                          <input type="hidden" name="intent" value="delete" />
                          <input type="hidden" name="id" value={i.id} />
                          <button className="link-btn" disabled={busy} aria-label={`Remove ${i.name}`}>✕</button>
                        </Form>
                      </td>
                    )}
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
