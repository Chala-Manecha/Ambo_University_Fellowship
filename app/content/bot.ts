import type { ContentLang } from "../lib/lang";

/**
 * Texts the Telegram bot sends. New visitors haven't chosen a language yet,
 * so the first messages carry both Afaan Oromoo and Amharic.
 * NOTE: draft wording — have a native speaker of each language review it.
 */
export const BOT = {
  start:
    "Baga nagaan dhuftan! Yaa'ii Mooraa Kaampaasii Hacaaluu Hundeessaa. Galmaa'uuf ykn akkaawuntii keessan banuuf armaan gadi tuqaa.\n\n" +
    "እንኳን በደኅና መጡ! ሃጫሉ ሁንዴሳ ካምፓስ ግቢ ጉባኤ። ለመመዝገብ ወይም መለያዎን ለመክፈት ከታች ይጫኑ።",
  openButton: "Akkaawuntii koo bani / መለያዬን ክፈት",
  linked: "✅ Telegram keessan akkaawuntii keessanitti hidhameera. Amma marsariitii irratti itti fufaa.\n\n✅ ቴሌግራምዎ ከመለያዎ ጋር ተገናኝቷል። አሁን በድረ-ገጹ ይቀጥሉ።",
  linkExpired: "Koodiin kun yeroon isaa darbeera. Marsariitii irratti \"Connect Telegram\" irra deebi'aa tuqaa.\n\nይህ ኮድ ጊዜው አልፎበታል። በድረ-ገጹ \"Connect Telegram\" እንደገና ይጫኑ።",
  linkTaken: "Telegram kun miseensa biraatti hidhameera.\n\nይህ ቴሌግራም ከሌላ አባል ጋር ተገናኝቷል።",
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
