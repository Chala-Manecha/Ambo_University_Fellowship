import { eq } from "drizzle-orm";
import { Form, Link, redirect, useNavigation, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/account.details";
import type { loader as rootLoader } from "../root";
import { MemberDetailsFields } from "../components/MemberDetailsFields";
import { getDb, schema } from "../db";
import { todayInAddis } from "../lib/departments";
import { DEFAULT_LANG } from "../lib/lang";
import { applyTitleRule, formToObject, memberDetailsSchema } from "../lib/registration";
import { requireUser } from "../lib/session.server";

export function meta() {
  return [{ title: "My details · Gibi Gubae" }];
}

async function loadMember(request: Request, env: Env) {
  const user = await requireUser(request, env);
  const member = await getDb(env.DB).query.members.findFirst({
    where: eq(schema.members.userId, user.id),
    columns: { id: true, gender: true, birthDate: true, title: true, services: true, otherService: true, learning: true },
  });
  if (!member) throw redirect("/register");
  return member;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const member = await loadMember(request, context.cloudflare.env);
  return { member, today: todayInAddis() };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const member = await loadMember(request, env);
  const parsed = memberDetailsSchema.safeParse(formToObject(await request.formData()));
  if (!parsed.success) {
    const fieldErrors: Partial<Record<string, string>> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { fieldErrors };
  }
  await getDb(env.DB)
    .update(schema.members)
    .set(applyTitleRule(member.gender, parsed.data))
    .where(eq(schema.members.id, member.id));
  throw redirect("/account?updated=1");
}

export default function MyDetails({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const nav = useNavigation();
  const { member, today } = loaderData;
  return (
    <section className="page narrow">
      <p className="muted"><Link to="/account">← My account</Link></p>
      <h1>My details</h1>
      <Form method="post" className="form" noValidate>
        <MemberDetailsFields
          lang={lang}
          showTitle={member.gender === "male"}
          today={today}
          defaults={member}
          errors={actionData?.fieldErrors ?? {}}
        />
        <button className="btn btn-primary" disabled={nav.state !== "idle"}>Save</button>
      </Form>
    </section>
  );
}
