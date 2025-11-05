import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Enable transpiling of local packages
  transpilePackages: ['@socket-hw/cli'],

  // Increase body size limit for large folder uploads (100MB)
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb'
    },
    // Also increase for API routes (replaces middlewareClientMaxBodySize)
    proxyClientMaxBodySize: '100mb'
  },

  // Allow cross-origin dev access from local network
  allowedDevOrigins: ['192.168.68.52'],

  // Turbopack configuration for Next.js 16+
  turbopack: {
    resolveAlias: {
      '@cli': path.join(__dirname, '../cli/dist')
    },
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.json']
  }
};

export default nextConfig;
