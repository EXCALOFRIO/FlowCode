/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Reemplazar serverActions: true por una configuración válida
    // y mover turbo a la raíz del config
  },
  // Turbopack ahora es estable y debe estar en la raíz
  turbopack: {
    // Configuración de Turbopack si es necesaria
  },
  async rewrites() {
    return [
      {
        source: '/api/docker/:path*',
        destination: 'http://localhost:9000/:path*',
      },
      {
        source: '/api/agent/:path*',
        destination: 'http://localhost:8001/:path*',
      },
    ]
  },
};

module.exports = nextConfig; 