import { redirect } from "react-router";

/** Old choice page: everyone now starts on their own dashboard. */
export function loader() {
  throw redirect("/account");
}
