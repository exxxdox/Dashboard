import { relayText } from "./i18n";
import type { CapabilityTestOutcome, ChatRequestPreview } from "./types.js";

export type CapabilityTestSummary = {
  tone: "ok" | "error";
  text: string;
};

export function formatDuration(milliseconds: number): string {
  return milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(2)} s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 测试结论的一句话摘要。
 *
 * 为什么把「未发出请求」和「已尝试 N 条路由」分开说：两者的排查方向完全不同——
 * 前者要看路由配置有没有生效，后者要看上游或模型。含糊成一句「失败」等于把线索丢掉。
 */
export function summarizeCapabilityTest(outcome: CapabilityTestOutcome, translate: typeof relayText = relayText): CapabilityTestSummary {
  if (outcome.ok) {
    return {
      tone: "ok",
      text: translate("调用成功 · {0} 次尝试 · 耗时 {1}", [outcome.attempts.length, formatDuration(outcome.totalMs)])
    };
  }
  const failedAttempts = outcome.attempts.length;
  return {
    tone: "error",
    text: translate("调用失败：{0} · {1}", [outcome.errorCode ?? translate("未知原因"), failedAttempts > 0 ? translate("已尝试 {0} 条路由", [failedAttempts]) : translate("未发出请求")])
  };
}

/**
 * 图片字段是整段 base64，直接展示会把弹窗刷成一屏字符，
 * 这里只留开头一小段并标出总长度——既看得到「确实带图了」，又不至于什么都看不见。
 */
export function truncateImages(body: ChatRequestPreview, keep = 24): ChatRequestPreview {
  return {
    ...body,
    messages: body.messages.map((message) => message.images
      ? { ...message, images: message.images.map((image) => image.length <= keep ? image : relayText("{0}…（共 {1} 字符）", [image.slice(0, keep), image.length])) }
      : message)
  };
}
