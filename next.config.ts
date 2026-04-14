import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/", destination: "/login.html" },
      { source: "/login", destination: "/login.html" },
      { source: "/dashboard", destination: "/dashboard.html" },
      { source: "/access-management", destination: "/access-management.html" },
      { source: "/employee", destination: "/employee.html" },
      { source: "/driver", destination: "/driver.html" },
    ];
  },
};

export default nextConfig;
