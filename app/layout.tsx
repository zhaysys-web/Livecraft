import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { AmbientBackground } from "@/components/layout/ambient-background";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://livecraft-ten.vercel.app"),
  title: "LiveCraft 灵动映像 — 高美感多媒体处理工作台",
  description:
    "视频转 Apple Live Photo、短视频无水印解析、图片去水印擦除，三件工具，一个深色工作台。",
  icons: {
    icon: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "LiveCraft 灵动映像",
    description: "视频转 Apple 实况照片 · 短视频无水印解析 · 图片去水印",
    url: "https://livecraft-ten.vercel.app",
    siteName: "LiveCraft 灵动映像",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
    locale: "zh_CN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "LiveCraft 灵动映像",
    description: "视频转 Apple 实况照片 · 短视频无水印解析 · 图片去水印",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className="dark">
      <body className={`${inter.variable} ${spaceGrotesk.variable} min-h-screen`}>
        <AmbientBackground />
        <div className="relative z-10 flex min-h-screen flex-col">
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
