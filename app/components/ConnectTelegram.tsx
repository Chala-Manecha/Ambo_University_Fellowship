import { useRevalidator } from "react-router";

/** Required step: connect the fellowship bot. One tap opens the bot with a one-time code; Start links it. */
export function ConnectTelegram({ linkUrl }: { linkUrl: string }) {
  const { revalidate, state } = useRevalidator();
  return (
    <div className="card connect-tg">
      <h2>📲 Connect Telegram to continue</h2>
      <p>
        The fellowship sends approvals, payment answers and reminders on Telegram. Connecting is required, and you only do it
        once. No phone number is shared.
      </p>
      <ol>
        <li>Tap <strong>Connect Telegram</strong>. The fellowship bot opens.</li>
        <li>Press <strong>Start</strong> at the bottom of the chat.</li>
        <li>Come back here and tap <strong>I pressed Start</strong>.</li>
      </ol>
      <p className="dash-links">
        <a href={linkUrl} className="btn btn-primary" target="_blank" rel="noreferrer">Connect Telegram</a>
        <button type="button" className="btn btn-quiet" onClick={() => revalidate()} disabled={state !== "idle"}>
          {state !== "idle" ? "Checking…" : "I pressed Start"}
        </button>
      </p>
      <p className="muted" lang="am">ቴሌግራም ማገናኘት ግዴታ ነው፤ “Connect Telegram” ይጫኑ፣ በቦቱ “Start” ይጫኑ፣ ከዚያ “I pressed Start” ይጫኑ።</p>
      <p className="muted" lang="om">Telegram hidhuun dirqama; “Connect Telegram” tuqaa, bootii keessatti “Start” tuqaa, achiis “I pressed Start” tuqaa.</p>
    </div>
  );
}
