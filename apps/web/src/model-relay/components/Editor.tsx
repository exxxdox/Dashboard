import { Modal } from "../../components/Modal";
import { useRelayT } from "../i18n";
import { useState, type FormEvent } from "react";
import { CapabilityEditor } from "./CapabilityEditor";
import type { AdminApi, Capability, Deployment, DiscoveredModel, EditorState, Endpoint, Route } from "../types";
import { Field } from "./ui";
import { useNotify } from "./Notifications";

export type EditorProps = {
  editor: Exclude<EditorState, null>;
  capabilities: Capability[];
  endpoints: Endpoint[];
  deployments: Deployment[];
  routes: Route[];
  discoveredModels: DiscoveredModel[] | null;
  refreshingModels: boolean;
  onRefreshModels: () => Promise<void>;
  api: AdminApi;
  onClose: () => void;
  onSaved: () => Promise<void>;
};

/** 能力与外部端点共享弹窗入口，内部部署由能力保存自动维护。 */
export function Editor(props: EditorProps) {
  // 能力集中编辑独立管理草稿，端点继续复用原有轻量表单。
  return props.editor.resource === "capabilities" ? <CapabilityEditor {...props} /> : <ResourceEditor {...props} />;
}

function ResourceEditor({ editor, endpoints, api, onClose, onSaved }: EditorProps) {
  const relayText = useRelayT();
  const notify = useNotify();
  const existing = endpoints.find((item) => item.id === editor.id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    // 启用状态只在列表切换；编辑请求不携带状态，避免覆盖其他窗口的开关操作。
    const body = { name: data.get("name"), baseUrl: data.get("baseUrl") };
    setSaving(true);
    setError(null);
    try {
      await api(`${editor.resource}${editor.id ? `/${editor.id}` : ""}`, { method: editor.id ? "PUT" : "POST", body: JSON.stringify(body) });
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : relayText("保存失败"));
      // 错误保留在表单，浮层消失后仍能对照修改输入。
      notify(caught instanceof Error ? caught.message : relayText("保存失败"), "error");
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={relayText("Ollama 端点")} size="lg">
      <div className="model-relay">
      <section className="modal">

        <form onSubmit={(event) => void submit(event)}>
          <Field name="name" label={relayText("端点名称")} defaultValue={String(existing?.name ?? "")} placeholder={relayText("本机 Ollama")} required />
          <Field name="baseUrl" label={relayText("服务根地址")} defaultValue={String(existing?.baseUrl ?? "")} placeholder="http://host.docker.internal:11434" required />
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>{relayText("取消")}</button>
            <button type="submit" disabled={saving}>{saving ? relayText("保存中…") : relayText("保存配置")}</button>
          </div>
        </form>
      </section>
      </div>
    </Modal>
  );
}
