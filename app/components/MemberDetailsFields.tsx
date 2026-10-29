import { FORM_TEXT, LEARNING, LEARNING_KEYS, SERVICES, SERVICE_KEYS, TITLES, TITLE_KEYS } from "../content/member-options";
import { isoToEc } from "../lib/ethiopian-date";
import type { ContentLang } from "../lib/lang";
import { EcDatePicker } from "./EcDatePicker";

export type DetailsDefaults = {
  birthDate: string | null;
  title: string | null;
  services: string[] | null;
  otherService: string | null;
  learning: string[] | null;
};

type Errors = Partial<Record<string, string>>;

/**
 * Birth date (EC wheels), title (men only), service areas and learning interests.
 * Used by the registration form and "Update my details".
 */
export function MemberDetailsFields({
  lang,
  showTitle,
  today,
  defaults,
  errors,
}: {
  lang: ContentLang;
  showTitle: boolean;
  today: string; // Gregorian YYYY-MM-DD
  defaults?: DetailsDefaults;
  errors: Errors;
}) {
  const t = FORM_TEXT[lang];
  const ecYear = isoToEc(today).year;
  const defaultBirth = defaults?.birthDate ?? `${Number(today.slice(0, 4)) - 20}-01-01`;
  const learning = defaults?.learning ?? LEARNING_KEYS; // all selected by default

  return (
    <>
      <EcDatePicker
        name="birthDate"
        label={`Birth date · ${t.birthDate}`}
        lang={lang}
        defaultIso={defaultBirth}
        minYear={ecYear - 70}
        maxYear={ecYear - 12}
        error={errors.birthDate}
      />

      {showTitle && (
        <fieldset className="field">
          <legend>Title <small>Optional</small></legend>
          <p lang={lang} className="field-hint">{t.title}</p>
          <div className="choices" lang={lang}>
            <label><input type="radio" name="title" value="" defaultChecked={!defaults?.title} /> —</label>
            {TITLE_KEYS.map((k) => (
              <label key={k}>
                <input type="radio" name="title" value={k} defaultChecked={defaults?.title === k} /> {TITLES[k][lang]}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="field" aria-invalid={Boolean(errors.services)}>
        <legend>Where you'd like to serve <small>Choose any</small></legend>
        <p lang={lang} className="field-hint">{t.serve}</p>
        <div className="checks" lang={lang}>
          {SERVICE_KEYS.map((k) => (
            <label key={k}>
              <input type="checkbox" name="services" value={k} defaultChecked={defaults?.services?.includes(k)} /> {SERVICES[k][lang]}
            </label>
          ))}
        </div>
        <label className="field other-field">
          <span lang={lang}>{t.other}</span>
          <input name="otherService" maxLength={100} defaultValue={defaults?.otherService ?? ""} />
        </label>
        {errors.services && <span className="field-error">{errors.services}</span>}
      </fieldset>

      <fieldset className="field">
        <legend>What you'd like to learn</legend>
        <p lang={lang} className="field-hint">{t.learn}</p>
        <div className="checks" lang={lang}>
          {LEARNING_KEYS.map((k) => (
            <label key={k}>
              <input type="checkbox" name="learning" value={k} defaultChecked={learning.includes(k)} /> {LEARNING[k][lang]}
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}
