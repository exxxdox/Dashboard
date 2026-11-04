import { useRelayT } from "../i18n";
import { useState } from "react";
import { CapabilityTestDialog } from "../components/CapabilityTestDialog";
import { EmptyRow, PageHeader, SectionHeader } from "../components/ui";
import type { AdminData } from "../hooks/useAdminData";
import type { Capability, ResourceName } from "../types";

export type CapabilitiesPageProps = {
  data: AdminData;
  onOpenEditor: (resource: ResourceName, id?: string) => void;
};

/** 能力设置：先定义 Agent 能调用的能力，再把能力绑到具体模型。 */
export function CapabilitiesPage({ data, onOpenEditor }: CapabilitiesPageProps) {
  const relayText = useRelayT();
  // 测试弹窗自己持有目标能力：测试是「看一眼」的操作，不该进编辑器那套共享状态。
  const [toggling, setToggling] = useState<Set<string>>(() => new Set());
  const [testing, setTesting] = useState<Capability | null>(null);

  return (
    <>
      <PageHeader title={relayText("能力设置")} description={relayText("定义 Agent 可调用的能力标识，并决定每个能力最终由哪些模型提供。")} />

      <section className="config-section">
        <SectionHeader title={relayText("能力")} description={relayText("配置 Agent 可调用的工具，以及使用的模型和回退路由。")} />
        <div className="table-wrap">
          <table>
            <thead><tr><th>{relayText("名称")}</th><th>{relayText("工具名（能力标识）")}</th><th>{relayText("描述")}</th><th>{relayText("状态")}</th><th /></tr></thead>
            <tbody>
              {data.capabilities.length === 0 && <EmptyRow columns={5} text={relayText("暂无可用能力")} />}
              {data.capabilities.map((item) => (
                <tr key={item.id}>
                  <td className="strong">{item.name}</td>
                  <td><code>{item.key}</code></td>
                  <td>{item.description}</td>
                  <td><button className="capability-switch" role="switch" aria-checked={item.enabled} aria-label={relayText("启用{0}", [item.name])} disabled={toggling.has(item.id)} aria-busy={toggling.has(item.id)} onClick={async () => {
                    setToggling((current) => new Set(current).add(item.id));
                    try { await data.setCapabilityEnabled(item); }
                    finally { setToggling((current) => { const next = new Set(current); next.delete(item.id); return next; }); }
                  }}><span aria-hidden="true" className="switch-track"><span /></span><span className="switch-label">{item.enabled ? relayText("启用") : relayText("停用")}</span></button></td>
                  <td><div className="row-actions"><button onClick={() => setTesting(item)}>{relayText("测试")}</button><button onClick={() => onOpenEditor("capabilities", item.id)}>{relayText("编辑")}</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 路由随所属能力编辑，避免在独立列表中重新选择能力。 */}

      {testing && <CapabilityTestDialog capability={testing} api={data.api} onClose={() => setTesting(null)} />}
    </>
  );
}
