import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata = {
  title: "隐私政策 · LiveCraft 灵动映像",
  description: "LiveCraft 隐私政策：我们如何处理你上传的内容与访问数据。",
};

const SECTIONS: { h: string; ps: string[] }[] = [
  {
    h: "1. 我们处理什么数据",
    ps: [
      "你主动上传的视频与图片：仅用于完成你发起的转换、解析或修复任务。文件保存在服务端任务目录，随任务自动删除（默认保留不超过 24 小时），不做长期存档。",
      "分享链接文本：解析工具需要把你粘贴的分享口令发送到后端，由后端向对应平台的公开页面请求视频信息；我们不存储这些链接。",
      "我们不要求注册账号，不收集姓名、电话、邮箱等身份信息，不做用户画像与广告追踪。",
    ],
  },
  {
    h: "2. 第三方服务",
    ps: [
      "当官方页面解析失败时，解析工具可能经由第三方备用解析服务获取视频直链（结果页会明确标注“第三方备用解析服务”）。此时你的分享链接会被发送给该第三方服务，其隐私政策以该服务方公布为准。",
      "前端托管于 Vercel，后端托管于 Render，两家基础设施提供商会按其自身政策记录基础的访问日志（如 IP、请求时间）。",
    ],
  },
  {
    h: "3. 数据保留与删除",
    ps: [
      "任务文件（含上传原片与生成结果）在任务完成后保留最多 24 小时用于下载，随后自动清理。",
      "结果页提供删除能力；如需提前删除某次任务文件，可通过页面上的重新生成/清理操作，或联系我们处理。",
    ],
  },
  {
    h: "4. 未成年人",
    ps: ["本服务面向一般用户，不主动收集未成年人信息。如你是未成年人，请在监护人指导下使用。"],
  },
  {
    h: "5. 联系与投诉",
    ps: [
      "隐私相关问题或删除请求，请通过 GitHub 仓库的 Issues 提出：https://github.com/zhaysys-web/Livecraft/issues，我们会尽快处理。",
    ],
  },
  {
    h: "6. 政策更新",
    ps: ["本政策可能随功能变化更新，更新后以本页面公布版本为准。最后更新：2026-10-19。"],
  },
];

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 pb-24 pt-10 sm:px-8">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-white/45 transition-colors hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        返回首页
      </Link>
      <h1 className="font-display mt-6 text-3xl font-bold">隐私政策</h1>
      <p className="mt-3 text-sm leading-relaxed text-white/45">
        LiveCraft（灵动映像）是一个免登录的多媒体处理工具。我们尽量少地处理你的数据——下面说清楚处理了什么、为什么、存多久。
      </p>
      <div className="mt-8 space-y-8">
        {SECTIONS.map((s) => (
          <section key={s.h}>
            <h2 className="text-lg font-semibold text-white">{s.h}</h2>
            <div className="mt-3 space-y-2.5">
              {s.ps.map((p, i) => (
                <p key={i} className="text-sm leading-relaxed text-white/60">
                  {p}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
