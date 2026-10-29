import type { ContentLang } from "../lib/lang";

/**
 * Homepage and description text. Interface labels stay in English (in the
 * components); only these texts switch language.
 * NOTE: draft wording — have a native speaker of each language review it.
 */
export const SITE = {
  universityEn: "Ambo University",
  campusEn: "Hachalu Hundessa Campus",
};

type HomeContent = {
  university: string;
  campus: string;
  church: string;
  title: string;
  tagline: string;
  about: string;
  activities: { title: string; body: string }[];
  steps: string[];
  registerIntro: string;
};

export const HOME: Record<ContentLang, HomeContent> = {
  am: {
    university: "አምቦ ዩኒቨርሲቲ",
    campus: "ሃጫሉ ሁንዴሳ ካምፓስ",
    church: "አዋሮ ደብረ ምህረት ቅዱስ ሚካኤል ቤተክርስቲያን",
    title: "እንኳን ወደ ግቢ ጉባኤያችን በደኅና መጡ",
    tagline: "በዩኒቨርሲቲ ቆይታችሁ በእምነት፣ በትምህርትና በአገልግሎት አብረን እንደግ።",
    about:
      "ግቢ ጉባኤ የኢትዮጵያ ኦርቶዶክስ ተዋሕዶ ቤተ ክርስቲያን ልጆች የሆኑ ተማሪዎች በግቢ ውስጥ መንፈሳዊ ትምህርት የሚማሩበት፣ የሚጸልዩበትና በየክፍሉ የሚያገለግሉበት ጉባኤ ነው።",
    activities: [
      { title: "ትምህርተ ሃይማኖት", body: "ለአዲስና ለነባር አባላት በመርሐ ግብር የሚሰጡ ኮርሶች።" },
      { title: "ጸሎትና መዝሙር", body: "የጋራ ጸሎት፣ የመዝሙር ጥናትና የበዓላት ዝግጅት።" },
      { title: "አገልግሎት", body: "እያንዳንዱ አባል በሚመቸው ክፍል ገብቶ ያገለግላል።" },
    ],
    steps: ["በቴሌግራም ይግቡ", "የምዝገባ ቅጹን ይሙሉ", "የክፍል መሪዎች ምዝገባዎን ያጸድቃሉ"],
    registerIntro: "ቅጹን በትክክል ይሙሉ። መረጃዎ ለጉባኤው አገልጋዮች ብቻ ይታያል።",
  },
  om: {
    university: "Yuunivarsiitii Amboo",
    campus: "Kaampaasii Hacaaluu Hundeessaa",
    church: "Mana Amantaa Tulluu Araaraa Qulqulluu Mikaa'el",
    title: "Gara Gibi Gubae keenyaatti baga nagaan dhuftan",
    tagline: "Yeroo yuunivarsiitii keessa turtan amantii, barnootaa fi tajaajilaan waliin haa guddannu.",
    about:
      "Gibi Gubaen walga'ii barattoota ijoollee Waldaa Kiristaanaa Ortodoksii Tewaahidoo Itiyoophiyaa ta'anii, mooraa keessatti barnoota hafuuraa itti baratan, itti kadhatanii fi kutaalee keessatti itti tajaajilanidha.",
    activities: [
      { title: "Barnoota amantii", body: "Koorsiiwwan miseensota haaraa fi duraaniif sagantaan kennaman." },
      { title: "Kadhannaa fi faarfannaa", body: "Kadhannaa waloo, qo'annoo faarfannaa fi qophii ayyaanaa." },
      { title: "Tajaajila", body: "Miseensi hundi kutaa isaaf mijatu keessatti ni tajaajila." },
    ],
    steps: ["Telegram'n seenaa", "Unka galmee guutaa", "Hoggantoonni kutaa galmee keessan ni mirkaneessu"],
    registerIntro: "Unka kana sirriitti guutaa. Odeeffannoon keessan tajaajiltoota walga'ichaa qofaaf mul'ata.",
  },
};
