import { useEffect, useId, useMemo, useRef, useState } from "react";
import { daysInEcMonth, EC_MONTHS, ecToIso, isoToEc, type EcDate } from "../lib/ethiopian-date";
import type { ContentLang } from "../lib/lang";

const ITEM_H = 40; // px, must match .wheel li height in app.css

type Item = { value: number; label: string };

/**
 * Ethiopian-calendar date picker: three scrollable wheels (day, month, year).
 * Submits the date as Gregorian YYYY-MM-DD in a hidden input called `name`.
 */
export function EcDatePicker({
  name,
  label,
  lang,
  defaultIso,
  minYear,
  maxYear,
  error,
}: {
  name: string;
  label: string;
  lang: ContentLang;
  defaultIso: string;
  minYear: number; // EC
  maxYear: number; // EC
  error?: string;
}) {
  const [ec, setEc] = useState<EcDate>(() => isoToEc(defaultIso));

  const days = useMemo<Item[]>(
    () => Array.from({ length: daysInEcMonth(ec.year, ec.month) }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
    [ec.year, ec.month],
  );
  const months = useMemo<Item[]>(() => EC_MONTHS[lang].map((m, i) => ({ value: i + 1, label: m })), [lang]);
  const years = useMemo<Item[]>(
    () => Array.from({ length: maxYear - minYear + 1 }, (_, i) => ({ value: minYear + i, label: String(minYear + i) })),
    [minYear, maxYear],
  );

  // Keep the day valid when month/year change (Pagume has 5 or 6 days)
  const update = (patch: Partial<EcDate>) =>
    setEc((prev) => {
      const next = { ...prev, ...patch };
      next.day = Math.min(next.day, daysInEcMonth(next.year, next.month));
      return next;
    });

  return (
    <fieldset className="field ec-picker" aria-invalid={Boolean(error)}>
      <legend>{label}</legend>
      <div className="wheels" lang={lang}>
        <Wheel label="Day" items={days} value={ec.day} onChange={(day) => update({ day })} />
        <Wheel label="Month" items={months} value={ec.month} onChange={(month) => update({ month })} wide />
        <Wheel label="Year" items={years} value={ec.year} onChange={(year) => update({ year })} />
      </div>
      <input type="hidden" name={name} value={ecToIso(ec)} />
      {error && <span className="field-error">{error}</span>}
    </fieldset>
  );
}

function Wheel({
  label,
  items,
  value,
  onChange,
  wide,
}: {
  label: string;
  items: Item[];
  value: number;
  onChange: (v: number) => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const uid = useId();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const index = Math.max(0, items.findIndex((i) => i.value === value));

  // Bring the selected item to the centre when it changes from outside
  useEffect(() => {
    const el = ref.current;
    if (el && Math.round(el.scrollTop / ITEM_H) !== index) el.scrollTop = index * ITEM_H;
  }, [index, items.length]);

  const settle = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const i = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM_H)));
      if (items[i] && items[i].value !== value) onChange(items[i].value);
    }, 90);
  };

  const step = (delta: number) => {
    const next = items[Math.min(items.length - 1, Math.max(0, index + delta))];
    if (next) {
      onChange(next.value);
      ref.current?.scrollTo({ top: items.indexOf(next) * ITEM_H, behavior: "smooth" });
    }
  };

  return (
    <div className={`wheel${wide ? " wheel-wide" : ""}`}>
      <ul
        ref={ref}
        role="listbox"
        aria-label={label}
        aria-activedescendant={`${uid}-${value}`}
        tabIndex={0}
        onScroll={settle}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); step(1); }
          if (e.key === "ArrowUp") { e.preventDefault(); step(-1); }
        }}
      >
        {items.map((item, i) => (
          <li
            key={item.value}
            id={`${uid}-${item.value}`}
            role="option"
            aria-selected={item.value === value}
            onClick={() => {
              onChange(item.value);
              ref.current?.scrollTo({ top: i * ITEM_H, behavior: "smooth" });
            }}
          >
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
