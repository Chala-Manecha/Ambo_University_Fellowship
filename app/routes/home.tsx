import { Link, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/home";
import type { loader as rootLoader } from "../root";
import { HOME, SITE } from "../content/site";
import { DEFAULT_LANG } from "../lib/lang";

export function meta(_: Route.MetaArgs) {
  return [
    { title: `Gibi Gubae · ${SITE.universityEn}, ${SITE.campusEn}` },
    { name: "description", content: "Campus fellowship: courses, prayer and service." },
  ];
}

export default function Home() {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const t = HOME[lang];
  const signedIn = Boolean(root?.user);
  // Registration starts in the Telegram bot (it collects a verified phone number)
  const botUrl = root?.botUrl ?? "#";

  return (
    <div lang={lang} className={`home lang-${lang}`}>
      <section className="hero">
        <p className="hero-uni">{t.university} · {t.campus}</p>
        <h1>{t.title}</h1>
        <p className="hero-tagline">{t.tagline}</p>
        <div className="hero-actions" lang="en">
          <a href={botUrl} className="btn btn-primary">Register as a member</a>
          {!signedIn && <Link to="/login" className="btn btn-quiet">Sign in</Link>}
        </div>
      </section>

      <div className="tilet" aria-hidden="true" />

      <section className="page about">
        <p className="lead">{t.about}</p>
        <p className="parish">
          <span lang="en">Our church</span>
          {t.church}
        </p>
      </section>

      <section className="page activities" aria-labelledby="activities-h">
        <h2 id="activities-h" lang="en" className="visually-hidden">What we do</h2>
        <ul>
          {t.activities.map((a) => (
            <li key={a.title}>
              <h3>{a.title}</h3>
              <p>{a.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="page join" aria-labelledby="join-h">
        <h2 id="join-h" lang="en">How to join</h2>
        <ol>
          {t.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <a href={botUrl} className="btn btn-primary" lang="en">Start registration</a>
      </section>
    </div>
  );
}
