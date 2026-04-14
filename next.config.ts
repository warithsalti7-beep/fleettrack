import type { NextConfig } from "next";

// Clean-URL map. One source of truth: add a page here once and its
// /clean path + legacy /clean.html both resolve, and "/" routes to
// login. Keep short — only list public routes.
const ROUTES: Array<{ slug: string; file: string }> = [
  { slug: "login",             file: "login.html" },
  { slug: "dashboard",         file: "dashboard.html" },
  { slug: "access-management", file: "access-management.html" },
  { slug: "driver",            file: "driver.html" },
];

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/", destination: "/login.html" },
      ...ROUTES.map((r) => ({ source: `/${r.slug}`, destination: `/${r.file}` })),
    ];
  },
  async redirects() {
    // Legacy-path safety net.
    return [
      { source: "/index.html", destination: "/driver", permanent: true },
      // Employees now use the main /dashboard (filtered by their perms).
      { source: "/employee",      destination: "/dashboard", permanent: true },
      { source: "/employee.html", destination: "/dashboard", permanent: true },
    ];
  },
  // Future: poweredByHeader false, compress true, etc.
};

export default nextConfig;
