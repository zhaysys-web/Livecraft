import type { MetadataRoute } from "next";

const BASE = "https://livecraft-ten.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const pages = ["", "/live-photo", "/parser", "/inpaint", "/privacy", "/terms"];
  return pages.map((p) => ({
    url: `${BASE}${p}`,
    lastModified: now,
    changeFrequency: p === "" ? "weekly" : "monthly",
    priority: p === "" ? 1 : 0.8,
  }));
}
