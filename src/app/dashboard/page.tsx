import { redirect } from "next/navigation";

/**
 * `/dashboard` is a legacy entry URL that is still used by bookmarks and
 * internal links. The active dashboard is the Command Center rendered at `/`.
 */
export default function DashboardPage() {
  redirect("/");
}
