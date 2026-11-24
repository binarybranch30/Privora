import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: "/api/live/:path*", destination: "http://127.0.0.1:8001/api/:path*" },
      { source: "/api/:path*", destination: (process.env.POLICYGUARD_API_ORIGIN ?? "http://127.0.0.1:8000") + "/api/:path*" },
    ];
  },
};
export default config;
