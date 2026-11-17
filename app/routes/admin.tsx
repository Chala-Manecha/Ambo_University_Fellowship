import { redirect } from "react-router";

/** The admin hub moved into the dashboard. Old links keep working. */
export function loader() {
  throw redirect("/dashboard");
}
