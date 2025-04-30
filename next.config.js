/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["child_process", "fs", "path"],
};

module.exports = nextConfig; 