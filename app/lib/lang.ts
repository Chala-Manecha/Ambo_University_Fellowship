export const CONTENT_LANGS = ["om", "am"] as const;
export type ContentLang = (typeof CONTENT_LANGS)[number];
export const DEFAULT_LANG: ContentLang = "om";
export const LANG_COOKIE = "lang";

export const LANG_LABELS: Record<ContentLang, string> = {
  om: "Afaan Oromoo",
  am: "አማርኛ",
};

export function parseLang(value: unknown): ContentLang {
  return CONTENT_LANGS.includes(value as ContentLang) ? (value as ContentLang) : DEFAULT_LANG;
}

export function langFromCookie(cookieHeader: string | null): ContentLang {
  const match = cookieHeader?.match(/(?:^|;\s*)lang=([a-z]{2})/);
  return parseLang(match?.[1]);
}
