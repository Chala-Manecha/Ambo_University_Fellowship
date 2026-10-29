import type { ContentLang } from "./lang";

/**
 * Ethiopian calendar (Amete Mihret) <-> Gregorian, via Julian Day Numbers.
 * Dates are stored as Gregorian "YYYY-MM-DD" in the database and shown in EC.
 * 12 months of 30 days + Pagume (5 days, 6 when the EC year % 4 === 3).
 */
export type EcDate = { year: number; month: number; day: number };

// Beyene–Kudlek: JDN offset for the Amete Mihret era
const EC_EPOCH = 1723856;

export const EC_MONTHS: Record<ContentLang, readonly string[]> = {
  am: ["መስከረም", "ጥቅምት", "ኅዳር", "ታኅሣሥ", "ጥር", "የካቲት", "መጋቢት", "ሚያዝያ", "ግንቦት", "ሰኔ", "ሐምሌ", "ነሐሴ", "ጳጉሜ"],
  om: ["Fulbaana", "Onkoloolessa", "Sadaasa", "Muddee", "Amajjii", "Guraandhala", "Bitootessa", "Ebla", "Caamsaa", "Waxabajjii", "Adoolessa", "Hagayya", "Qaammee"],
};

export function isEcLeapYear(year: number) {
  return year % 4 === 3;
}

export function daysInEcMonth(year: number, month: number) {
  if (month < 13) return 30;
  return isEcLeapYear(year) ? 6 : 5;
}

function gregorianToJdn(y: number, m: number, d: number) {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

function jdnToGregorian(jdn: number) {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    day: e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year: 100 * b + d - 4800 + Math.floor(m / 10),
  };
}

function ecToJdn({ year, month, day }: EcDate) {
  return EC_EPOCH + 365 + 365 * (year - 1) + Math.floor(year / 4) + 30 * month + day - 31;
}

function jdnToEc(jdn: number): EcDate {
  const r = (jdn - EC_EPOCH) % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  return {
    year: 4 * Math.floor((jdn - EC_EPOCH) / 1461) + Math.floor(r / 365) - Math.floor(r / 1460),
    month: Math.floor(n / 30) + 1,
    day: (n % 30) + 1,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function isValidEc({ year, month, day }: EcDate) {
  return Number.isInteger(year) && year > 0 && month >= 1 && month <= 13 && day >= 1 && day <= daysInEcMonth(year, month);
}

/** EC date -> Gregorian "YYYY-MM-DD" */
export function ecToIso(ec: EcDate) {
  const g = jdnToGregorian(ecToJdn(ec));
  return `${g.year}-${pad(g.month)}-${pad(g.day)}`;
}

/** Gregorian "YYYY-MM-DD" -> EC date */
export function isoToEc(iso: string): EcDate {
  const [y, m, d] = iso.split("-").map(Number);
  return jdnToEc(gregorianToJdn(y, m, d));
}

/** "20 ጥቅምት 2019" / "20 Onkoloolessa 2019" */
export function formatEc(iso: string | null | undefined, lang: ContentLang) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—";
  const ec = isoToEc(iso);
  return `${ec.day} ${EC_MONTHS[lang][ec.month - 1]} ${ec.year}`;
}

/** Whole years between a Gregorian birth date and today. */
export function ageOn(birthIso: string, todayIso: string) {
  const [by, bm, bd] = birthIso.split("-").map(Number);
  const [ty, tm, td] = todayIso.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}
