import { Link, useNavigate } from "react-router";

/** "← Back" to the page you came from; opens `fallback` when there's no history (a shared link). */
export function BackLink({ fallback, label = "Back" }: { fallback: string; label?: string }) {
  const navigate = useNavigate();
  return (
    <Link
      to={fallback}
      onClick={(e) => {
        if (window.history.length > 1 && document.referrer.startsWith(window.location.origin)) {
          e.preventDefault();
          navigate(-1);
        }
      }}
    >
      ← {label}
    </Link>
  );
}
