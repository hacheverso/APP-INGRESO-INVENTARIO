/** @type {import('next').NextConfig} */
const nextConfig = {
    eslint: {
        // Warning: This allows production builds to successfully complete even if
        // your project has ESLint errors. Needed for ESLint 9 circular JSON bug on Vercel.
        ignoreDuringBuilds: true,
    },
};

export default nextConfig;
