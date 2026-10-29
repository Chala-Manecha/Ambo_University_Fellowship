import type { ContentLang } from "../lib/lang";

/**
 * Texts the Telegram bot sends. New visitors haven't chosen a language yet,
 * so the first messages carry both Afaan Oromoo and Amharic.
 * NOTE: draft wording — have a native speaker of each language review it.
 */
export const BOT = {
  start:
    "Baga nagaan dhuftan! Yaa'ii Mooraa Kaampaasii Hacaaluu Hundeessaatti galmaa'uuf, armaan gaditti \"Lakkoofsa bilbilaa qoodi\" tuqaa.\n\n" +
    "እንኳን በደኅና መጡ! በሃጫሉ ሁንዴሳ ካምፓስ ግቢ ጉባኤ ለመመዝገብ ከታች ያለውን \"ስልክ ቁጥሬን አጋራ\" ይጫኑ።",
  shareButton: "📱 Lakkoofsa bilbilaa qoodi / ስልክ ቁጥሬን አጋራ",
  notOwnContact:
    "Lakkoofsa bilbilaa keessan qofa qoodaa.\n\nእባክዎ የራስዎን ስልክ ቁጥር ብቻ ያጋሩ።",
  saved: "Galatoomaa! Lakkoofsi bilbilaa keessan galmaa'eera.\n\nእናመሰግናለን! ስልክ ቁጥርዎ ተመዝግቧል።",
  continue: "Galmee itti fufuuf armaan gadi tuqaa.\n\nምዝገባውን ለመቀጠል ከታች ይጫኑ።",
  continueButton: "Galmee itti fufi / ምዝገባውን ቀጥል",
} as const;

export const MEMBER_DECISION: Record<ContentLang, { approved: string; rejected: string }> = {
  om: {
    approved: "Galmeen keessan mirkanaa'eera. Baga Yaa'ii Mooraatti nagaan dhuftan!",
    rejected: "Galmeen keessan hin mirkanoofne. Hoggantoota Yaa'ichaa Telegram irratti qunnamaa.",
  },
  am: {
    approved: "ምዝገባዎ ጸድቋል። እንኳን ወደ ግቢ ጉባኤ በደኅና መጡ!",
    rejected: "ምዝገባዎ አልጸደቀም። እባክዎ የጉባኤውን መሪዎች በቴሌግራም ያግኙ።",
  },
};

/** Sent when a department leader approves a join request. */
export const DEPARTMENT_APPROVED: Record<ContentLang, (department: string) => string> = {
  om: (d) => `${d} keessatti miseensummaan keessan mirkanaa'eera.`,
  am: (d) => `በ${d} አባልነትዎ ጸድቋል።`,
};

/** t.me link that opens the bot and sends /start <payload>. */
export function botLink(botUsername: string, payload = "register") {
  return `https://t.me/${botUsername}?start=${payload}`;
}
