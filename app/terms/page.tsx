import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";

export const metadata = {
  title: "使用条款 · LiveCraft 灵动映像",
  description: "LiveCraft 使用条款：合理使用、权利归属与版权投诉入口。",
};

const SECTIONS: { h: string; ps: string[] }[] = [
  {
    h: "1. 服务内容",
    ps: [
      "LiveCraft 提供三项免费工具：视频转 Apple 实况照片、短视频分享链接解析、图片局部修复。服务按“现状”提供，我们会尽力保证可用，但不承诺 100% 在线（后端免费托管资源会在空闲时休眠，首次访问可能需要约一分钟唤醒）。",
    ],
  },
  {
    h: "2. 合理使用",
    ps: [
      "请仅上传你拥有权利或已获得授权的内容；不得利用本服务侵犯他人著作权、肖像权等合法权益。",
      "解析工具用于获取你有权下载的视频；去水印工具用于处理你自己的图片。请勿批量抓取、勿用于任何违法用途。",
      "为保护服务稳定，我们对接口频率、并发任务、上传大小与视频时长设有限制，超限会返回明确错误。",
    ],
  },
  {
    h: "3. 内容权利",
    ps: [
      "你上传内容的所有权利仍归你所有。我们仅为完成你发起的任务而临时处理这些文件，不主张任何权利，也不会将其用于训练模型或对外分享。",
      "生成结果的著作权归属遵循你原内容的权利状态；实况照片的元数据写入仅为 iPhone 相册兼容，不改变权利归属。",
    ],
  },
  {
    h: "4. 免责",
    ps: [
      "因平台方页面结构变化，解析结果可能失效；因视频编码差异，个别视频可能无法转换。我们会在页面上给出明确提示，但不保证每一次任务都成功。",
      "在法律允许的最大范围内，我们不对因使用本服务产生的间接损失承担责任。",
    ],
  },
  {
    h: "5. 版权投诉",
    ps: [
      "如果你认为本服务涉及侵犯你的著作权，请通过以下入口提交投诉，我们会在核实后尽快处理：",
    ],
  },
];

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 pb-24 pt-10 sm:px-8">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-white/45 transition-colors hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        返回首页
      </Link>
      <h1 className="font-display mt-6 text-3xl font-bold">使用条款</h1>
      <p className="mt-3 text-sm leading-relaxed text-white/45">
        使用 LiveCraft 即表示你同意以下条款。最后更新：2026-10-19。
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
            {s.h.startsWith("5.") && (
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                <p className="text-sm text-white/70">版权投诉入口</p>
                <ul className="mt-2.5 space-y-2 text-sm text-white/55">
                  <li>
                    · 请在投诉中写明：权利证明、被投诉内容描述、你的联系方式。
                  </li>
                  <li>
                    ·
                    提交到GitHubIssues（公开处理，响应最快）：
                    <a
                      href="https://github.com/zhaysys-web/Livecraft/issues"
                      target="_blank"
                      rel="noreferrer"
                      className="ml-1 inline-flex items-center gap-1 text-aurora-cyan hover:underline"
                    >
                      zhaysys-web/Livecraft
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </li>
                </ul>
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
