import { redirect } from "react-router";
import type { Route } from "./+types/me";
import { requireUser } from "../lib/session.server";

/** Where sign-in lands: everyone's own dashboard. Leaders switch to "Leadership" at the top. */
export async function loader({ request, context }: Route.LoaderArgs) {
  await requireUser(request, context.cloudflare.env);
  throw redirect("/account");
}
