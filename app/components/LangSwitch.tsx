import { Form, useLocation } from "react-router";
import { CONTENT_LANGS, LANG_LABELS, type ContentLang } from "../lib/lang";

export function LangSwitch({ current }: { current: ContentLang }) {
  const location = useLocation();
  return (
    <Form method="post" action="/lang" className="lang-switch" aria-label="Content language">
      <input type="hidden" name="redirectTo" value={location.pathname + location.search} />
      {CONTENT_LANGS.map((l) => (
        <button
          key={l}
          type="submit"
          name="lang"
          value={l}
          aria-pressed={l === current}
          lang={l}
        >
          {LANG_LABELS[l]}
        </button>
      ))}
    </Form>
  );
}
