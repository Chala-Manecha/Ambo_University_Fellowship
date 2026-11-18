import { Outlet, redirect, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/office";
import type { loader as rootLoader } from "../root";
import { Panel, type PanelGroup } from "../components/Panel";
import { todayInAddis } from "../lib/departments";
import { formatEc } from "../lib/ethiopian-date";
import { DEFAULT_LANG, type ContentLang } from "../lib/lang";
import { can } from "../lib/permissions";
import { requireUser } from "../lib/session.server";

export function meta() {
  return [{ title: "ጽህፈት ቤት · Gibi Gubae" }];
}

/** Sunday first, matching Date.getUTCDay(). */
const WEEKDAYS: Record<ContentLang, string[]> = {
  am: ["እሑድ", "ሰኞ", "ማክሰኞ", "ረቡዕ", "ሐሙስ", "ዓርብ", "ቅዳሜ"],
  om: ["Dilbata", "Wiixata", "Kibxata", "Roobii", "Kamiisa", "Jimaata", "Sanbata"],
};

/** ጽህፈት ቤት: the chair, vice chair and secretary (and any other admin). */
export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await requireUser(request, context.cloudflare.env);
  if (!can(user.role, "member:manage")) throw redirect("/lead");
  const today = todayInAddis();
  return { name: user.name, today, weekday: new Date(`${today}T12:00:00Z`).getUTCDay() };
}

export default function Office({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const { name, today, weekday } = loaderData;
  const groups: PanelGroup[] = [
    {
      label: "Members",
      items: [
        { to: "/office/members", label: "Members list", icon: "👥" },
        { to: "/office/roles", label: "Roles & positions", icon: "🎖️" },
      ],
    },
    {
      label: "Money",
      items: [
        { to: "/office/dues", label: "Contributions", icon: "💳" },
        { to: "/office/gifts", label: "ለመርዳት", icon: "🤲" },
        { to: "/office/ledger", label: "Money in & out", icon: "📒" },
        { to: "/office/properties", label: "Property", icon: "📦" },
      ],
    },
    {
      label: "Programs",
      items: [
        { to: "/office/fasts", label: "Fasts", icon: "🍲" },
        { to: "/office/attendance", label: "Attendance", icon: "✅" },
        { to: "/office/songs", label: "Songs", icon: "🎵" },
      ],
    },
    {
      label: "Admin",
      items: [
        { to: "/office/audit", label: "Audit", icon: "🔎" },
        { to: "/office/overview", label: "Overview", icon: "📊" },
        { to: "/office/telegram", label: "Telegram bot", icon: "🤖" },
      ],
    },
  ];
  return (
    <section className="page wide panel-page">
      <Panel
        title="ጽህፈት ቤት"
        titleLang="am"
        sub={
          <>
            <p>{name}</p>
            <p className="panel-date" lang={lang}>
              <b>{WEEKDAYS[lang][weekday]}</b> {formatEc(today, lang)}
            </p>
          </>
        }
        back={{ to: "/lead", label: "All departments" }}
        groups={groups}
      />
      <div className="panel-content">
        <Outlet />
      </div>
    </section>
  );
}
