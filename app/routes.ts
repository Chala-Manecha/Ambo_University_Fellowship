import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("register", "routes/register.tsx"),
  route("account", "routes/account.tsx"),
  route("admin/registrations", "routes/admin.registrations.tsx"),
  route("lang", "routes/lang.ts"),
  route("logout", "routes/logout.ts"),
  route("api/auth/*", "routes/api.auth.ts"),
] satisfies RouteConfig;
