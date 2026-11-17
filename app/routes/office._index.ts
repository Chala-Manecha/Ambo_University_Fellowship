import { redirect } from "react-router";

/** /office opens on the members list. */
export function loader() {
  throw redirect("/office/members");
}
