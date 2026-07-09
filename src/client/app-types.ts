export type Page = "dashboard" | "settings" | "templates" | "deploy" | "sites" | "domains";

export const PAGE_PATHS: Record<Page, string> = {
  dashboard: "/",
  settings: "/credenciais",
  templates: "/templates",
  deploy: "/criar",
  sites: "/sites",
  domains: "/dominios",
};

export function pageFromPath(pathname: string): Page {
  const path = pathname.replace(/\/+$/, "") || "/";

  if (path === "/credenciais") return "settings";
  if (path === "/templates") return "templates";
  if (path === "/criar") return "deploy";
  if (path === "/sites") return "sites";
  if (path === "/dominios") return "domains";

  return "dashboard";
}
