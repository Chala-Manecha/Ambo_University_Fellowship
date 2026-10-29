import type { ContentLang } from "../lib/lang";

/**
 * Choices on the registration form. Keys are stored in the database; labels
 * follow the language switch.
 * NOTE: the Afaan Oromoo labels are drafts — have a native speaker review them.
 */
type Labels = Record<ContentLang, string>;

/** Church title, offered to male members only. */
export const TITLES = {
  diakon: { am: "ዲያቆን", om: "Diyaaqon" },
  kesis: { am: "ቀሲስ", om: "Qasiis" },
  merigeta: { am: "መሪጌታ", om: "Mergeetaa" },
  memhir: { am: "መምህር", om: "Memhir" },
} as const satisfies Record<string, Labels>;
export type TitleKey = keyof typeof TITLES;
export const TITLE_KEYS = Object.keys(TITLES) as TitleKey[];

/** "Which of the following do you want to serve in?" */
export const SERVICES = {
  fast_coordination: { am: "ጾም አስተባባሪ", om: "Qindeessaa soomaa" },
  preaching: { am: "ሰባኪ/አስተማሪ", om: "Lallabaa/Barsiisaa" },
  course_teaching: { am: "ኮርስ አሰተማሪ", om: "Barsiisaa koorsii" },
  abinet_teaching: { am: "አብነት አስተማሪ", om: "Barsiisaa abinatii" },
  hymn_training: { am: "መዝሙር አስጠኚ", om: "Leenjisaa faarfannaa" },
  tsiwa: { am: "ጽዋ ዝግጅት", om: "Qophii xiwaa" },
  holidays: { am: "በጥምቀትና በአደባባይ በዓላት", om: "Ayyaana Cuuphaa fi ayyaanota ummataa" },
  visiting_needy: { am: "በነዳያን ጥየቃ", om: "Rakkattoota gaafachuu" },
  trips: { am: "ጉዞ ማስተባበር", om: "Imala qindeessuu" },
  cafe: { am: "ካፌ ማስተባበር", om: "Kaafee qindeessuu" },
  family: { am: "በቤተሰብ አደረጃጀት", om: "Gurmaa'ina maatii" },
  graduation: { am: "በምረቃ ዝግጅት", om: "Qophii eebbaa" },
  theatre: { am: "ቲያትር/ተውኔት", om: "Diraamaa/Tiyaatira" },
  labour: { am: "በጉልበት ስራ", om: "Hojii humnaa" },
  cleaning: { am: "በጽዳትና ንጽህና ስራ", om: "Hojii qulqullinaa" },
} as const satisfies Record<string, Labels>;
export type ServiceKey = keyof typeof SERVICES;
export const SERVICE_KEYS = Object.keys(SERVICES) as ServiceKey[];

/** "What do you want to learn?" — all selected by default. */
export const LEARNING = {
  hymns: { am: "መዝሙር ማጥናት", om: "Faarfannaa barachuu" },
  abinet: { am: "አብነት መማር", om: "Abinat barachuu" },
  courses: { am: "ኮርስ መማር", om: "Koorsii barachuu" },
} as const satisfies Record<string, Labels>;
export type LearningKey = keyof typeof LEARNING;
export const LEARNING_KEYS = Object.keys(LEARNING) as LearningKey[];

export const FORM_TEXT: Record<
  ContentLang,
  { title: string; serve: string; other: string; learn: string; departments: string; birthDate: string }
> = {
  am: {
    title: "ማዕረግ (ካለዎት)",
    serve: "ከሚከተሉት በየትኛው ማገልገል ይፈልጋሉ?",
    other: "ሌላ",
    learn: "ምን መማር ይፈልጋሉ?",
    departments: "በየትኛው ክፍል ማገልገል ይፈልጋሉ?",
    birthDate: "የትውልድ ቀን",
  },
  om: {
    title: "Maqaa tajaajilaa (yoo qabaattan)",
    serve: "Kanneen armaan gadii keessaa isa kamiin tajaajiluu barbaaddu?",
    other: "Kan biroo",
    learn: "Maal barachuu barbaaddu?",
    departments: "Kutaa kamiin tajaajiluu barbaaddu?",
    birthDate: "Guyyaa dhalootaa",
  },
};
