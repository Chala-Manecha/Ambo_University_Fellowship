import { createRequestHandler } from "react-router";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: { env: Env; ctx: ExecutionContext };
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    return requestHandler(request, { cloudflare: { env, ctx } });
  },

  // Daily Cron Trigger. Telegram reminders (attendance, schedule, contributions)
  // are wired up in a later round; this stays a no-op until then.
  async scheduled(_controller, _env, _ctx) {},
} satisfies ExportedHandler<Env>;
