import { desc, eq } from "drizzle-orm";
import { Form, Link, redirect, useNavigation, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/give";
import type { loader as rootLoader } from "../root";
import { ReceiptInput } from "../components/ReceiptInput";
import { getDb, schema } from "../db";
import { checkReceipt } from "../lib/contributions";
import { formatEc } from "../lib/ethiopian-date";
import { DEFAULT_LANG } from "../lib/lang";
import { notifyMoneyReviewers } from "../lib/ledger.server";
import { requireUser } from "../lib/session.server";
import { getPayAccount } from "../lib/settings.server";

export function meta() {
  return [{ title: "ለመርዳት · Gibi Gubae" }];
}

const TEXT = {
  am: { title: "ለመርዳት", intro: "ጊቢ ጉባኤውን ለመርዳት ወደዚህ ሂሳብ ይላኩ፤ ከዚያ የደረሰኙን ስክሪንሾት ያስገቡ።", thanks: "እናመሰግናለን! ስጦታዎ ደርሷል፤ ሲረጋገጥ በቴሌግራም መልዕክት ይደርስዎታል።" },
  om: { title: "Gargaaruuf", intro: "Yaa'ii Mooraa gargaaruuf herrega kanaan ergaa; achiis suuraa ragaa kaffaltii galchaa.", thanks: "Galatoomaa! Kennaan keessan nu ga'eera; yeroo mirkanaa'u Telegram irratti ergaan isin ga'a." },
} as const;

async function load(request: Request, env: Env) {
  const user = await requireUser(request, env);
  const db = getDb(env.DB);
  const member = await db.query.members.findFirst({ where: eq(schema.members.userId, user.id), columns: { id: true, fullName: true } });
  if (!member) throw redirect("/register");
  return { db, member };
}

/** ለመርዳት: any member can give to the fellowship account and send the receipt. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const { db, member } = await load(request, env);
  const [account, mine] = await Promise.all([
    getPayAccount(db),
    db
      .select({ id: schema.donations.id, amount: schema.donations.amount, status: schema.donations.status, createdAt: schema.donations.createdAt, reviewNote: schema.donations.reviewNote })
      .from(schema.donations)
      .where(eq(schema.donations.memberId, member.id))
      .orderBy(desc(schema.donations.createdAt))
      .limit(20),
  ]);
  return { account, mine: mine.map((m) => ({ ...m, createdAt: m.createdAt.getTime() })), sent: new URL(request.url).searchParams.has("sent") };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.cloudflare;
  const { db, member } = await load(request, env);
  const form = await request.formData();
  const amount = Number(form.get("amount"));
  if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) return { error: "Enter the amount in whole birr." };
  const receipt = checkReceipt(form.get("receipt"));
  if (!receipt.ok) return { error: receipt.error };
  const note = String(form.get("note") ?? "").trim().slice(0, 300) || null;
  const id = crypto.randomUUID();
  const ext = receipt.file.type === "image/png" ? "png" : receipt.file.type === "image/jpeg" ? "jpg" : "webp";
  const key = `donations/${id}.${ext}`;
  await env.MEDIA.put(key, receipt.file.stream(), { httpMetadata: { contentType: receipt.file.type } });
  await db.insert(schema.donations).values({ id, memberId: member.id, donorName: member.fullName, amount, note, receiptKey: key });
  ctx.waitUntil(notifyMoneyReviewers(env, db, `ለመርዳት: ${member.fullName} · ${amount} birr\nReview: ${env.PUBLIC_SITE_URL}/departments/herrega/gifts`));
  throw redirect("/give?sent=1");
}

const STATUS = { pending: "Waiting review", approved: "Received", rejected: "Not accepted" } as const;

export default function Give({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const busy = useNavigation().state !== "idle";
  const { account, mine, sent } = loaderData;
  return (
    <section className="page narrow">
      <p className="muted"><Link to="/account">← My dashboard</Link></p>
      <h1 lang="am">🤲 {TEXT.am.title} <small lang="om">/ {TEXT.om.title}</small></h1>
      {sent && <p className="notice" role="status" lang={lang}>{TEXT[lang].thanks}</p>}
      <p lang={lang}>{TEXT[lang].intro}</p>

      {account.number ? (
        <div className="card pay-account">
          <dl>
            <dt>Bank / service</dt><dd>{account.bank}</dd>
            <dt>Account number</dt><dd><strong className="acct-number">{account.number}</strong></dd>
            <dt>Account name</dt><dd>{account.name}</dd>
          </dl>
          {account.note && <p className="muted">{account.note}</p>}
        </div>
      ) : (
        <p className="form-error">The fellowship account isn't set yet. Ask ባች እና ዲፓርትመንት.</p>
      )}

      <Form method="post" encType="multipart/form-data" className="card form">
        <h2>I sent a gift</h2>
        {actionData?.error && <p className="form-error" role="alert">{actionData.error}</p>}
        <label className="field">
          <span>Amount (birr)</span>
          <input name="amount" type="number" inputMode="numeric" min={1} max={1000000} required />
        </label>
        <ReceiptInput label="Receipt" hint="Screenshot or photo of the transfer" preparing="Preparing photo…" />
        <label className="field">
          <span>Note <small>Optional</small></span>
          <input name="note" maxLength={300} placeholder="e.g. for the fast meals" />
        </label>
        <button className="btn btn-primary" disabled={busy || !account.number}>{busy ? "Sending…" : "Send"}</button>
      </Form>

      {mine.length > 0 && (
        <div className="card">
          <h2>My gifts</h2>
          <ul className="session-list">
            {mine.map((g) => (
              <li key={g.id}>
                <span lang={lang}>{formatEc(new Date(g.createdAt + 3 * 3600 * 1000).toISOString().slice(0, 10), lang)}</span> · <strong>{g.amount} birr</strong>{" "}
                <span className={`pill pill-pay-${g.status === "approved" ? "approved" : g.status === "pending" ? "pending" : "unpaid"}`}>{STATUS[g.status]}</span>
                {g.status === "rejected" && g.reviewNote && <span className="muted"> · {g.reviewNote}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
