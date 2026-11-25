import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    const livePort = Number(process.env.PRIVORA_LIVE_API_PORT ?? 8001);
    if (!Number.isInteger(livePort) || livePort < 1024 || livePort > 65535) throw new Error("Invalid loopback Live API port");
    return [
      { source: "/api/live/:path*", destination: "http://127.0.0.1:" + livePort + "/api/:path*" },
      { source: "/api/:path*", destination: (process.env.PRIVORA_API_ORIGIN ?? "http://127.0.0.1:8000") + "/api/:path*" },
    ];
  },
};
export default config;
