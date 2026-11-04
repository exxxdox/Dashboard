import { useRelayT } from "../i18n";
import { useState, type FormEvent } from "react";
import type { AdminApi, RuntimeSettings } from "../types";
import { Check, SectionHeader } from "./ui";
import { useNotify } from "./Notifications";

const BYTES_PER_MB = 1_024 * 1_024;

export type RuntimeSettingsPanelProps = {
  settings: RuntimeSettings;
  api: AdminApi;
  onSaved: (settings: RuntimeSettings) => void;
};

/** 图片大小与并发上限的表单；单位换算集中在这里，避免页面重复计算。 */
export function RuntimeSettingsPanel({ settings, api, onSaved }: RuntimeSettingsPanelProps) {
  const relayText = useRelayT();
  const notify = useNotify();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const maxImageMb = Number(data.get("maxImageMb"));
    const maxConcurrentRequests = Number(data.get("maxConcurrentRequests"));
    setSaving(true);
    setError(null);
    try {
      const next = await api<RuntimeSettings>("settings", {
        method: "PUT",
        body: JSON.stringify({
          maxImageBytes: Math.round(maxImageMb * BYTES_PER_MB),
          maxConcurrentRequests,
          allowNetworkAccess: data.get("allowNetworkAccess") === "on"
        })
      });
      onSaved(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : relayText("保存失败"));
      // 浮层提示操作结果，表单仍保留错误供修正时查看。
      notify(caught instanceof Error ? caught.message : relayText("保存失败"), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="config-section">
      <SectionHeader title={relayText("运行设置")} description={relayText("控制 MCP 端点的网络可达范围，以及图片大小与并发上限。")} />
      <form className="runtime-form" onSubmit={(event) => void submit(event)} key={settings.updatedAt}>
        <div className="runtime-access">
          <Check name="allowNetworkAccess" label={relayText("允许网络访问 MCP 端点")} defaultChecked={settings.allowNetworkAccess} />
          <small>{relayText("关闭后仅允许本机与服务器同网段访问；通过反向代理时按代理地址判断。")}</small>
        </div>
        <label className="field">
          <span>{relayText("单张图片上限（MB）")}</span>
          <input name="maxImageMb" type="number" min="0.01" max="50" step="0.01" defaultValue={(settings.maxImageBytes / BYTES_PER_MB).toFixed(2)} required />
          <small>{relayText("范围 0.01–50 MB，超过限制的请求会在转发前拒绝。")}</small>
        </label>
        <label className="field">
          <span>{relayText("最大并发请求数")}</span>
          <input name="maxConcurrentRequests" type="number" min="1" max="32" step="1" defaultValue={settings.maxConcurrentRequests} required />
          <small>{relayText("范围 1–32，超出的请求会等待已有任务完成。")}</small>
        </label>
        <div className="runtime-save">
          {error && <p className="form-error">{error}</p>}
          <button type="submit" disabled={saving}>{saving ? relayText("保存中…") : relayText("保存运行设置")}</button>
        </div>
      </form>
    </section>
  );
}
