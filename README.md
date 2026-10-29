# Ambo University Gibi Gubae — campus fellowship site

React Router v7 on Cloudflare Workers · D1 + Drizzle · Better Auth (Telegram login) · Turnstile.
Interface in English; homepage and description text in Afaan Oromoo and Amharic (`app/content/site.ts`).

## Round 1 (this commit)
- Homepage with language switch (cookie, works without JavaScript)
- Telegram sign-in (Better Auth plugin, signature verified server-side)
- Member registration form (Turnstile-protected, one per login, status `pending`)
- Review page for admins: approve / reject pending registrations
- `can(role, permission)` in `app/lib/permissions.ts` — every protected loader/action goes through `requirePermission()`

## First-time setup
1. `npm install`, then `cp .dev.vars.example .dev.vars` and fill it in.
2. D1 database id is already set in `wrangler.jsonc`. If your D1 database isn't named
   `gibi-gubae-db`, change `database_name` there to match the dashboard.
3. `npx wrangler r2 bucket create ambo-fellowship-media` (used from round 2: photos).
4. `npm run db:migrate:local`, then `npm run dev`. On localhost use the
   "Developer sign-in" on /login — Telegram's widget doesn't run on localhost.
5. Telegram bot: create with @BotFather, then `/setdomain` → your workers.dev or custom domain.
   Set `TELEGRAM_BOT_USERNAME` in `wrangler.jsonc`.
6. Turnstile: create a widget in the dashboard; set `TURNSTILE_SITE_KEY` in `wrangler.jsonc`.
7. Secrets: `npx wrangler secret put BETTER_AUTH_SECRET` (and `TELEGRAM_BOT_TOKEN`, `TURNSTILE_SECRET_KEY`).
   Generate the auth secret with `openssl rand -base64 32`.
8. Deploy: connect the GitHub repo in Workers → Settings → Builds (build command `npm run build`,
   deploy command `npx wrangler deploy`). Run `npm run db:migrate:remote` after schema changes.

## Making the first admin
Sign in once with Telegram, then:
```
npx wrangler d1 execute DB --remote --command "UPDATE user SET role='admin' WHERE telegram_username='your_username'"
```
Sign out and back in (sessions cache the role for 5 minutes).

## Changing the schema
Edit `app/db/schema.ts` → `npm run db:generate` → `npm run db:migrate:local` → commit the new file in `drizzle/`.

## Scripts
`npm run dev` · `npm test` · `npm run typecheck` · `npm run build` · `npm run deploy`

## Notes
- Logins are Telegram-only: password hashing exceeds the Workers free-plan CPU limit (10 ms).
- Roles: `member`, `dept_leader`, `finance`, `admin`. Add permissions in `PERMISSIONS`, and a test.
- Daily cron (`0 5 * * *` = 08:00 Addis) is wired in `workers/app.ts` but does nothing yet.
