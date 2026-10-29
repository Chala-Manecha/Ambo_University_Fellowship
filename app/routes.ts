import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("register", "routes/register.tsx"),
  route("account", "routes/account.tsx"),
  route("departments", "routes/departments.tsx"),
  route("departments/:id", "routes/departments.$id.tsx"),
  route("attendance", "routes/attendance.tsx"),
  route("attendance/:id", "routes/attendance.$id.tsx"),
  route("admin", "routes/admin.tsx"),
  route("admin/members", "routes/admin.members.tsx"),
  route("admin/registrations", "routes/admin.registrations.tsx"),
  route("admin/telegram", "routes/admin.telegram.tsx"),
  route("tg", "routes/tg.tsx"),
  route("telegram/webhook", "routes/telegram.webhook.ts"),
  route("lang", "routes/lang.ts"),
  route("logout", "routes/logout.ts"),
  route("api/auth/*", "routes/api.auth.ts"),
] satisfies RouteConfig;
