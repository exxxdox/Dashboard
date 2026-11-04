import { relayText } from "./i18n";
import type { AdminApi } from "./types";

export type AdminApiOptions = {
  /** 401 时的回调：由调用方清理会话状态，这里只负责通知。 */
  onUnauthorized: () => void;
};

/**
 * 管理 API 客户端。抽成不依赖 React 的工厂函数，
 * 是为了直接测试统一会话、401 通知和错误消息提取。
 */
export function createAdminApi({ onUnauthorized }: AdminApiOptions): AdminApi {
  return async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`/api/model-relay/${path}`, {
      ...init,
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        ...init?.headers
      }
    });
    if (response.status === 401) {
      onUnauthorized();
      throw new Error(relayText("访问令牌无效"));
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(body?.error?.message ?? relayText("请求失败"));
    }
    // 204 没有响应体，直接解析会抛错。
    return (response.status === 204 ? undefined : await response.json()) as T;
  };
}
