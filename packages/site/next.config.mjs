/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  turbopack: {
    root: new URL('../..', import.meta.url).pathname
  },
  images: {
    unoptimized: true
  }
};

export default nextConfig;
