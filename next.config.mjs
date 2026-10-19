/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // standalone 输出：阶段五 Docker 多阶段构建直接使用
  output: "standalone",
  images: {
    // 阶段三：解析到的短视频封面走远端图片，需要时在此放行域名
    remotePatterns: [],
  },
  experimental: {
    // 阶段三：Serverless Function 处理大文件上传时放宽限制需配合平台配置
  },
};

export default nextConfig;
