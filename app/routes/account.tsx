import { and, desc, eq, gte, ne } from "drizzle-orm";
import { useState } from "react";
import { Form, Link, redirect, useNavigation, useRouteLoaderData, useSearchParams } from "react-router";
import { renderSVG } from "uqr";
import type { loader as rootLoader } from "../root";
import type { Route } from "./+types/account";
import { TabBar, Tile, Tiles } from "../components/Dash";
import { ReceiptInput } from "../components/ReceiptInput";
import { TITLES } from "../content/member-options";
import { getDb, schema } from "../db";
import { getPasswordHash, isTelegramLinked } from "../lib/accounts.server";
import { telegramGate } from "../lib/telegram-gate.server";
import { ConnectTelegram } from "../components/ConnectTelegram";
import {
  checkMonths,
  checkReceipt,
  contributionSchema,
  dueMonth,
  formatMonth,
  memberKind,
  monthKey,
  payableMonths,
  rateFor,
  type EcMonth,
} from "../lib/contributions";
import { memberHistory, memberMonthStatus, notifyReviewers, type PayStatus } from "../lib/contributions.server";
import { pickParam } from "../lib/dashboard";
import { attendanceRate, ATTENDANCE_LABELS, departmentName, isPosition, POSITION_LABELS, todayInAddis } from "../lib/departments";
import { getLeaderDepartmentIds } from "../lib/departments.server";
import { formatEc } from "../lib/ethiopian-date";
import { FAST_TYPE_LABELS, isFastOn } from "../lib/fasts";
import { DEFAULT_LANG } from "../lib/lang";
import { memberQrText } from "../lib/member-qr";
import { hasDashboard } from "../lib/permissions";
import { formatYear } from "../lib/registration";
import { requireUser } from "../lib/session.server";
import { getDues, getPayAccount } from "../lib/settings.server";

export function meta() {
  return [{ title: "My dashboard · Gibi Gubae" }];
}

async function loadMember(db: ReturnType<typeof getDb>, userId: string) {
  return db.query.members.findFirst({
    where: eq(schema.members.userId, userId),
    columns: {
      id: true, status: true, fullName: true, christianName: true, title: true, studentId: true, birthDate: true,
      fieldOfStudy: true, yearOfStudy: true, contentLanguage: true, photoKey: true,
    },
  });
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env.DB);
  const url = new URL(request.url);
  const flags = {
    registered: url.searchParams.has("registered"),
    updated: url.searchParams.has("updated"),
    password: url.searchParams.has("password"),
    paid: url.searchParams.has("paid"),
  };
  const [member, hash, leaderOf, me] = await Promise.all([
    loadMember(db, user.id),
    getPasswordHash(db, user.id),
    getLeaderDepartmentIds(db, user.id),
    db.query.user.findFirst({ where: eq(schema.user.id, user.id), columns: { position: true } }),
  ]);
  const base = {
    user,
    flags,
    hasPassword: Boolean(hash),
    position: me?.position ?? null,
    staff: hasDashboard(user.role) || leaderOf.length > 0,
  };
  if (!member) return { ...base, member: null } as const;
  const tgGate = await telegramGate(db, env, user.id);
  if (tgGate) return { ...base, member, tgGate } as const;

  const today = todayInAddis();
  const current = dueMonth(today);
  const kind = memberKind(member.yearOfStudy);
  const [dues, account, statusByMonth, history, departments, attendance, fast] = await Promise.all([
    getDues(db),
    getPayAccount(db),
    memberMonthStatus(db, member.id),
    memberHistory(db, member.id),
    db
      .select({
        id: schema.departments.id,
        nameOm: schema.departments.nameOm,
        nameAm: schema.departments.nameAm,
        role: schema.departmentMembers.role,
        status: schema.departmentMembers.status,
      })
      .from(schema.departmentMembers)
      .innerJoin(schema.departments, eq(schema.departments.id, schema.departmentMembers.departmentId))
      .where(and(eq(schema.departmentMembers.memberId, member.id), ne(schema.departmentMembers.status, "rejected"))),
    db
      .select({
        sessionId: schema.attendanceSessions.id,
        title: schema.attendanceSessions.title,
        date: schema.attendanceSessions.date,
        status: schema.attendanceRecords.status,
        nameOm: schema.departments.nameOm,
        nameAm: schema.departments.nameAm,
      })
      .from(schema.attendanceRecords)
      .innerJoin(schema.attendanceSessions, eq(schema.attendanceSessions.id, schema.attendanceRecords.sessionId))
      .leftJoin(schema.departments, eq(schema.departments.id, schema.attendanceSessions.departmentId))
      .where(eq(schema.attendanceRecords.memberId, member.id))
      .orderBy(desc(schema.attendanceSessions.date)),
    db.query.fasts.findFirst({ where: gte(schema.fasts.endDate, today), orderBy: schema.fasts.startDate }),
  ]);
  const fastReg = fast
    ? await db.query.fastRegistrations.findFirst({
        where: and(eq(schema.fastRegistrations.fastId, fast.id), eq(schema.fastRegistrations.memberId, member.id)),
        columns: { fastType: true },
      })
    : undefined;

  const months = payableMonths(current).map((m) => ({ ...m, status: statusByMonth.get(monthKey(m)) ?? ("unpaid" as PayStatus) }));
  return {
    ...base,
    member,
    kind,
    rate: rateFor(kind, dues),
    account,
    current,
    currentStatus: statusByMonth.get(monthKey(current)) ?? ("unpaid" as PayStatus),
    // Unpaid months up to now (arrears), not counting months ahead
    owed: months.filter((m) => monthKey(m) <= monthKey(current) && m.status === "unpaid").length,
    months,
    history: history.map((h) => ({ ...h, createdAt: h.createdAt.getTime() })),
    departments,
    attendance: attendance.slice(0, 20),
    rate2: attendanceRate(attendance.map((a) => a.status)),
    fast: fast ? { id: fast.id, name: fast.name, isOn: isFastOn(fast, today), fastType: fastReg?.fastType ?? null } : null,
    qrSvg: member.status === "active" ? renderSVG(await memberQrText(member.id, env.BETTER_AUTH_SECRET), { border: 2 }) : null,
  };
}

/** A member submits a payment: months, amount, receipt screenshot. */
export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env.DB);
  const member = await loadMember(db, user.id);
  if (!member || member.status !== "active") return { error: "Payments open once your membership is approved." };
  if (!(await isTelegramLinked(db, user.id))) return { error: "Connect Telegram first." };
  const form = await request.formData();

  const parsed = contributionSchema.safeParse({ months: form.getAll("months").map(String), amount: form.get("amount"), note: form.get("note") ?? undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const current = dueMonth(todayInAddis());
  const months = checkMonths(parsed.data.months, payableMonths(current));
  if (!months) return { error: "Choose months from the list." };
  const receipt = checkReceipt(form.get("receipt"));
  if (!receipt.ok) return { error: receipt.error };

  const dues = await getDues(db);
  const kind = memberKind(member.yearOfStudy);
  const id = crypto.randomUUID();
  const ext = receipt.file.type === "image/png" ? "png" : receipt.file.type === "image/jpeg" ? "jpg" : "webp";
  const key = `receipts/${id}.${ext}`;
  await env.MEDIA.put(key, receipt.file.stream(), { httpMetadata: { contentType: receipt.file.type } });

  try {
    await db.batch([
      db.insert(schema.contributions).values({
        id,
        memberId: member.id,
        amount: parsed.data.amount,
        monthlyRate: rateFor(kind, dues),
        memberKind: kind,
        months: months.map((m) => [m.year, m.month] as [number, number]),
        note: parsed.data.note,
        receiptKey: key,
      }),
      ...months.map((m) => db.insert(schema.contributionMonths).values({ contributionId: id, memberId: member.id, ecYear: m.year, ecMonth: m.month })),
    ]);
  } catch {
    // The unique (member, month) index refused: one of the months is already paid or waiting
    ctx.waitUntil(env.MEDIA.delete(key));
    return { error: "One of those months is already paid or waiting for review." };
  }

  const list = months.map((m) => formatMonth(m, "am")).join(", ");
  ctx.waitUntil(notifyReviewers(env, db, `New payment: ${member.fullName} · ${parsed.data.amount} birr · ${list}\nReview: ${env.PUBLIC_SITE_URL}/dues`));
  throw redirect("/account?tab=pay&paid=1");
}

const STATUS_TEXT = {
  pending: "Your registration is waiting for review by the fellowship leaders.",
  active: "",
  rejected: "Your registration wasn't approved. Contact a fellowship leader on Telegram.",
  alumni: "You're listed as an alumnus. Thank you for your service.",
} as const;

const PAY_LABEL = { approved: "Paid", pending: "Waiting review", unpaid: "Not paid" } as const;
const TABS = ["home", "pay", "attendance", "departments"] as const;

export default function Account({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const [params] = useSearchParams();
  const d0 = loaderData;
  const tab = pickParam(params.get("tab"), TABS) ?? "home";

  if (!d0.member) {
    return (
      <section className="page narrow">
        <h1>My account</h1>
        <p>You haven't registered as a member yet. <Link to="/register">Register now</Link></p>
        <Form method="post" action="/logout"><button className="btn btn-quiet">Sign out</button></Form>
      </section>
    );
  }
  if ("tgGate" in d0 && d0.tgGate) {
    const g = d0.member;
    return (
      <section className="page narrow member-dash">
        <header className="page-head member-head">
          <h1>{g.fullName}</h1>
          <p className="page-head-sub">{formatYear(g.yearOfStudy)} · {g.fieldOfStudy} · {g.studentId}</p>
        </header>
        {d0.flags.registered && <p className="notice" role="status">Registration submitted. One more step:</p>}
        <ConnectTelegram linkUrl={d0.tgGate.linkUrl} />
        <Form method="post" action="/logout" className="danger-zone"><button className="btn btn-quiet btn-sm">Sign out</button></Form>
      </section>
    );
  }
  const d = d0 as Loaded;
  const m = d.member;
  const active = m.status === "active";

  return (
    <section className="page wide member-dash">
      <header className="page-head member-head">
        <div className="page-head-top">
          <span />
          <div className="page-head-actions">
            {d.staff && <Link to="/dashboard">🗂️ Dashboard</Link>}
            <Link to="/account/password">⚙️ Password</Link>
          </div>
        </div>
        <div className="member-id">
          <Link to="/account/details" className="member-photo" aria-label={m.photoKey ? "Change my photo" : "Add my photo"}>
            {m.photoKey ? <img src={`/photos/${m.id}`} alt="" width={64} height={64} /> : <span aria-hidden="true">📷</span>}
          </Link>
          <h1>
            {m.title && <span lang={lang}>{TITLES[m.title][lang]} </span>}
            {m.fullName}
          </h1>
        </div>
        <p className="page-head-sub">
          {formatYear(m.yearOfStudy)} · {m.fieldOfStudy} · {m.studentId}
          {isPosition(d.position) && <> · <span lang={lang}>{POSITION_LABELS[d.position][lang]}</span></>}
        </p>
      </header>

      {d.flags.registered && <p className="notice" role="status">Registration submitted.</p>}
      {d.flags.updated && <p className="notice" role="status">Details saved.</p>}
      {d.flags.password && <p className="notice" role="status">Password saved. You can sign in on the website with your student ID.</p>}
      {d.flags.paid && <p className="notice" role="status">Payment submitted. You'll get a Telegram message when it's reviewed.</p>}
      {STATUS_TEXT[m.status] && <p className={`status status-${m.status}`}>{STATUS_TEXT[m.status]}</p>}
      {!d.hasPassword && (
        <p className="notice">Set a password so you can also sign in on the website with your student ID. <Link to="/account/password">Set password</Link></p>
      )}
      {!m.birthDate && (
        <p className="notice">Please complete your details (birth date, where you'd like to serve). <Link to="/account/details">Update my details</Link></p>
      )}

      <TabBar
        active={tab}
        tabs={[
          { key: "home", to: "?tab=home", label: "Home", icon: "🏠" },
          { key: "pay", to: "?tab=pay", label: "Payment", icon: "💳", count: active ? d.owed : undefined, alert: true },
          { key: "attendance", to: "?tab=attendance", label: "Attendance", icon: "🙋", count: d.attendance.length },
          { key: "departments", to: "?tab=departments", label: "Departments", icon: "🏛️", count: d.departments.length },
        ]}
      />

      {tab === "home" && (
        <>
          <Tiles>
            {active && (
              <Tile
                to="?tab=pay"
                n={PAY_LABEL[d.currentStatus]}
                label={<span lang={lang}>{formatMonth(d.current, lang)} · {d.rate} birr</span>}
                tone={d.currentStatus === "approved" ? "green" : d.currentStatus === "pending" ? "gold" : "red"}
              />
            )}
            <Tile to="?tab=attendance" n={d.rate2.percent === null ? "—" : `${d.rate2.percent}%`} label={`Attendance (${d.rate2.present}/${d.rate2.present + d.rate2.absent})`} />
            {d.fast && (
              <Tile
                to={`/fasts/${d.fast.id}/join`}
                n={d.fast.fastType ? "✓" : "Register"}
                label={<span lang={lang}>{d.fast.name}{d.fast.fastType ? ` · ${FAST_TYPE_LABELS[d.fast.fastType][lang].split(" · ")[1]}` : ""}</span>}
                tone={d.fast.fastType ? "green" : d.fast.isOn ? "gold" : "slate"}
              />
            )}
            <Tile to="?tab=departments" n={d.departments.filter((x) => x.status === "active").length} label="My departments" tone="slate" />
          </Tiles>

          {active && d.qrSvg && (
            <div className="card member-card">
              <div className="member-qr" role="img" aria-label="Your member QR code" dangerouslySetInnerHTML={{ __html: d.qrSvg }} />
              <p className="muted">Show this at the cafe during fasts.</p>
            </div>
          )}

          <p className="dash-links">
            <Link to="/account/details" className="btn btn-quiet btn-sm">✏️ Edit my details & photo</Link>
            <Link to="/fasts" className="btn btn-quiet btn-sm">🍲 Fasts</Link>
            <Link to="/departments" className="btn btn-quiet btn-sm">🏛️ All departments</Link>
          </p>
        </>
      )}

      {tab === "pay" && (active ? <PayTab d={d} lang={lang} error={actionData?.error} /> : <div className="card"><p className="muted">Payments open once your membership is approved.</p></div>)}

      {tab === "attendance" && (
        <div className="card">
          {d.attendance.length === 0 ? (
            <p className="muted">No attendance recorded yet.</p>
          ) : (
            <>
              <p>{d.rate2.percent === null ? "—" : `${d.rate2.percent}%`} attended ({d.rate2.present} present, {d.rate2.absent} absent, {d.rate2.excused} excused)</p>
              <div className="table-wrap">
                <table className="table-oneline">
                  <thead><tr><th>Date</th><th>Session</th><th>Where</th><th>Status</th></tr></thead>
                  <tbody>
                    {d.attendance.map((a) => (
                      <tr key={a.sessionId}>
                        <td lang={lang}>{formatEc(a.date, lang)}</td>
                        <td>{a.title}</td>
                        <td lang={lang}>{a.nameOm && a.nameAm ? departmentName({ nameOm: a.nameOm, nameAm: a.nameAm }, lang) : "Whole fellowship"}</td>
                        <td><span className={`pill pill-${a.status}`}>{ATTENDANCE_LABELS[a.status]}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "departments" && (
        <div className="card">
          {d.departments.length === 0 ? (
            <p className="muted">You haven't joined a department yet. <Link to="/departments">See departments</Link></p>
          ) : (
            <ul className="session-list">
              {d.departments.map((x) => (
                <li key={x.id}>
                  <span lang={lang}>{departmentName(x, lang)}</span>{" "}
                  <span className={`pill pill-${x.status}`}>{x.status === "pending" ? "Request sent" : x.role === "leader" ? "Leader" : "Member"}</span>
                  {x.role === "leader" && x.status === "active" && <> · <Link to={`/departments/${x.id}`}>Manage</Link></>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Form method="post" action="/logout" className="danger-zone">
        <button className="btn btn-quiet btn-sm">Sign out</button>
      </Form>
    </section>
  );
}

type Loaded = Extract<Route.ComponentProps["loaderData"], { kind: unknown }>;

function PayTab({ d, lang, error }: { d: Loaded; lang: "om" | "am"; error?: string }) {
  const busy = useNavigation().state !== "idle";
  const open = d.months.filter((m) => m.status === "unpaid");
  const [picked, setPicked] = useState<string[]>(() =>
    open.filter((m) => monthKey(m) <= monthKey(d.current)).map((m) => `${m.year}-${m.month}`),
  );
  const amount = picked.length * d.rate;
  const key = (m: EcMonth) => `${m.year}-${m.month}`;

  return (
    <>
      <div className="card pay-account">
        <h2>Pay to the fellowship account</h2>
        {d.account.number ? (
          <dl className="pay-dl">
            <dt>Bank</dt><dd>{d.account.bank || "—"}</dd>
            <dt>Account number</dt><dd><strong className="acct-number">{d.account.number}</strong></dd>
            <dt>Name</dt><dd>{d.account.name || "—"}</dd>
            {d.account.note && <><dt>Note</dt><dd>{d.account.note}</dd></>}
          </dl>
        ) : (
          <p className="muted">The account hasn't been set yet. Ask ባች እና ዲፓርትመንት.</p>
        )}
        <p>
          Monthly amount for you ({d.kind === "graduate" ? "graduated" : "student"}):{" "}
          <strong>{d.rate ? `${d.rate} birr` : "not set yet"}</strong>
        </p>
      </div>

      <div className="card">
        <h2>My months</h2>
        <div className="month-grid" lang={lang}>
          {d.months.map((m) => (
            <span key={key(m)} className={`month-cell pay-${m.status}${monthKey(m) === monthKey(d.current) ? " is-current" : ""}`}>
              <span>{formatMonth(m, lang)}</span>
              <small>{PAY_LABEL[m.status]}</small>
            </span>
          ))}
        </div>
      </div>

      {d.rate > 0 && open.length > 0 && (
        <div className="card">
          <h2>Submit a payment</h2>
          {error && <p className="form-error" role="alert">{error}</p>}
          <Form method="post" encType="multipart/form-data" className="form">
            <fieldset className="field">
              <legend>Months you paid for</legend>
              <div className="checks" lang={lang}>
                {open.map((m) => (
                  <label key={key(m)}>
                    <input
                      type="checkbox"
                      name="months"
                      value={key(m)}
                      checked={picked.includes(key(m))}
                      onChange={(e) => setPicked((p) => (e.target.checked ? [...p, key(m)] : p.filter((x) => x !== key(m))))}
                    />{" "}
                    {formatMonth(m, lang)}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="field">
              <span>Amount paid (birr) <small>{picked.length} × {d.rate} = {amount}</small></span>
              <input name="amount" type="number" min={1} required key={amount} defaultValue={amount || ""} />
            </label>
            <ReceiptInput label="Receipt" hint="Screenshot or photo of the transfer" preparing="Preparing photo…" />
            <label className="field">
              <span>Note <small>Optional</small></span>
              <input name="note" maxLength={300} placeholder="e.g. paid by a friend's account" />
            </label>
            <button className="btn btn-primary" disabled={busy || picked.length === 0}>{busy ? "Sending…" : "Submit payment"}</button>
          </Form>
        </div>
      )}

      <div className="card">
        <h2>History</h2>
        {d.history.length === 0 ? (
          <p className="muted">No payments yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table-oneline">
              <thead><tr><th>Submitted</th><th>Months</th><th className="num">Amount</th><th>Status</th><th>Receipt</th></tr></thead>
              <tbody>
                {d.history.map((h) => (
                  <tr key={h.id}>
                    <td lang={lang}>{formatEc(new Date(h.createdAt + 3 * 3600 * 1000).toISOString().slice(0, 10), lang)}</td>
                    <td lang={lang}>{h.months.map(([y, mo]) => formatMonth({ year: y, month: mo }, lang)).join(", ")}</td>
                    <td className="num">{h.amount}</td>
                    <td>
                      <span className={`pill pill-pay-${h.status === "rejected" ? "unpaid" : h.status}`}>{h.status === "rejected" ? "Rejected" : PAY_LABEL[h.status]}</span>
                      {h.reviewNote && <span className="muted"> · {h.reviewNote}</span>}
                    </td>
                    <td><a href={`/receipts/${h.id}`} target="_blank" rel="noreferrer">View</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
