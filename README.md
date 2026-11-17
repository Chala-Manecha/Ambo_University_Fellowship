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
7. Secrets: `npx wrangler secret put BETTER_AUTH_SECRET` (and `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TURNSTILE_SECRET_KEY`).
   Generate the auth secret with `openssl rand -base64 32`.
8. Deploy: connect the GitHub repo in Workers → Settings → Builds (build command `npm run build`,
   deploy command `npx wrangler deploy`). Run `npm run db:migrate:remote` after schema changes.

## Signing in
- **Website:** student ID + password (`/login`). The ID matches however it's typed ("ugr/1234/16" = "UGR 1234 16").
  5 wrong passwords in 15 minutes lock that student ID for 15 minutes. Passwords are PBKDF2 hashes in `account`.
- **Telegram:** the bot never asks for a phone number. `/start` shows **Open my account**, which opens `/tg` as a
  Mini App and signs in from Telegram's signed data. A Telegram account seen for the first time is offered
  "Register" or "Sign in once to link" (student ID + password), so no duplicate accounts are made.
- After signing in, `/me` sends admins, cafe coordinators and department leaders to `/dashboard`, others to `/account`.
- Registration (`/register`) works signed out; everyone sets a password. Phone is optional.
- Forgotten password: an admin presses **Reset password** on `/admin/members` and passes on the temporary password.
- Bot setup: `TELEGRAM_WEBHOOK_SECRET` secret, then **Connect webhook** on `/admin/telegram`.

## Departments & attendance
- 9 departments are created by migration `0002` (names in Afaan Oromoo and Amharic; they follow the language switch).
- Members ask to join on `/departments`; the department's leaders get a Telegram message and approve on `/departments/<id>`.
- Admins appoint leaders on the department page (the person must be a member of it first). Leaders get the
  `dept_leader` role automatically and lose it when they no longer lead any department.
- Leaders take attendance for their department; admins take whole-fellowship attendance on `/attendance`.
  Rate = present / (present + absent); excused doesn't count against anyone.
- Positions (Walitti qabaa / ዋና ሰብሳቢ, Itti aanaa / ምክትል ሰብሳቢ, Barreessaa / ጸሐፊ) are set on `/admin/members`.
  Each position belongs to one person and comes with admin access.
- Access rules live in `app/lib/departments.ts` and are covered by `tests/departments.test.ts`.

## Member details, QR codes & fasts
- Registration also asks for birth date, title (men only), service areas, learning interests and departments.
  Existing members fill these in on **My account → Update my details**. Option labels are in
  `app/content/member-options.ts` (Afaan Oromoo labels are drafts).
- All dates are picked and shown in the Ethiopian calendar (`app/lib/ethiopian-date.ts`, scroll-wheel
  picker in `app/components/EcDatePicker.tsx`); the database stores Gregorian `YYYY-MM-DD`.
- Approved members get a QR code on My account. It's signed with `BETTER_AUTH_SECRET`, so changing that
  secret changes everyone's QR code.
- Fasts (`/fasts`): an admin creates a fast (dates + meals) and prints its **Poster** (`/fasts/<id>/poster`, A4 with a
  QR to `/fasts/<id>/join`). Members scan it, sign in or register, and choose how they fast: meat only (3 meals),
  skips breakfast (lunch + dinner) or skips breakfast and lunch (dinner). They get a QR to show at the cafe.
- The coordinator (admin or **Cafe coordinator** role) sees the fast page: counts per fast type, the registered list
  (student ID, name, registration date, type) and a **Daily meals** table with ← Prev / Next →, where meals can be
  ticked by hand. The scanner (`/fasts/<id>/scan`) refuses meals someone fasts from and has a search for people
  without their QR. Each person is served once per meal per day. Pending members (not yet approved) are served too.

## Dashboards
- `/dashboard` (admins, department leaders, cafe coordinators): members by status, gender, year of study,
  service areas and learning interests; departments with members, requests, leaders and attendance %;
  current fasts; recent fellowship attendance. Every number links to the list behind it. `/admin` redirects here.
- `/members` (admins and department leaders): filter chips that combine (gender, year, department, wants to
  serve, wants to learn, missing details) plus search; `⬇ CSV` downloads exactly what's filtered.
- Each department page has tiles and tabs: Members, Requests, Attendance.
- Logic is in `app/lib/dashboard.ts` and `app/lib/member-filters.ts`, tested in `tests/dashboard.test.ts`.

## Monthly contributions, member dashboard, who sees what
- **My account** is the member dashboard: header card, tabs Home / Payment / Attendance / Departments.
  Home shows this month's payment status, attendance %, the current fast and the member QR.
- **Payment:** the member sees the fellowship account and their rate (students vs graduated), picks the EC months
  (6 back to 3 ahead), enters the amount and attaches a receipt photo (private, in R2 under `receipts/`).
  A month can't be paid twice. Leaders and admins get a Telegram message.
- **/dues** (admins and ባች እና ዲፓርትመንት leaders): review receipts (approve / reject with a note; rejecting frees
  the months), who paid per month with ← → and filters, and the amounts + account settings. The member is told on Telegram.
- **Members list** (`/members`): admins and leaders of አባላት ጉዳይ (`miseensa`) and ባች እና ዲፓርትመንት (`baachii`).
  Other leaders see only their own department's members. Rules in `app/lib/departments.ts`, tested.
- The site is always light (white theme); it no longer follows the phone's dark mode.

## Telegram is required, roles, menu
- After registering, a member must **Connect Telegram**: the button opens `t.me/<bot>?start=link_<code>`
  (one-time code, 30 minutes); pressing Start links that Telegram account. Until then My dashboard, fast
  registration and payments are locked. Codes live in `telegram_link_tokens`.
- Registration accepts English letters only (names, field of study, notes).
- **Roles & positions** (`/admin/members`): Position (ዋና ሰብሳቢ / ምክትል ሰብሳቢ / ጸሐፊ) gives admin access and removing
  it removes it; **Leads department** appoints the department leader (one department per person); Role for
  Cafe coordinator / Finance / Admin without a position.
- **☰ Menu**: everything the person can open, plus all departments (admins manage all; leaders their own).

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
