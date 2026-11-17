import type { Db } from "../db";
import { canListMembers, canManageDues } from "./departments";
import { getLeaderDepartmentIds } from "./departments.server";
import { requireUser } from "./session.server";

/** Signed-in user plus what their department leadership allows. */
export async function getAccess(request: Request, env: Env, db: Db) {
  const user = await requireUser(request, env);
  const leaderOf = await getLeaderDepartmentIds(db, user.id);
  return { user, leaderOf, listMembers: canListMembers(user.role, leaderOf), manageDues: canManageDues(user.role, leaderOf) };
}

export async function requireMemberList(request: Request, env: Env, db: Db) {
  const a = await getAccess(request, env, db);
  if (!a.listMembers) throw new Response("You don't have access to this page.", { status: 403 });
  return a;
}

export async function requireDues(request: Request, env: Env, db: Db) {
  const a = await getAccess(request, env, db);
  if (!a.manageDues) throw new Response("You don't have access to this page.", { status: 403 });
  return a;
}
