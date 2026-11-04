import { useI18n } from "../../lib/i18n";
import { useRelayT } from "../i18n";
import { RuntimeSettingsPanel } from "../components/RuntimeSettingsPanel";
import { PageHeader, SectionHeader } from "../components/ui";
import type { AdminData } from "../hooks/useAdminData";

export type SettingsPageProps = { data: AdminData };

/** 设置：与业务配置无关的两块——访问凭据和运行限制。 */
export function SettingsPage({ data }: SettingsPageProps) {
  const relayText = useRelayT();
  const { locale } = useI18n();
  return (
    <>
      <PageHeader title={relayText("设置")} description={relayText("管理 MCP 调用密钥、网络访问范围与资源限制。")} />

      <section className="config-section">
        <SectionHeader title={relayText("访问凭据")} description={relayText("查看或轮转 Agent 使用的 MCP 调用密钥。")} />
        <div className="credential-grid">
          {data.credentials.filter((credential) => credential.kind === "mcp").map((credential) => {
            const revealed = data.revealedCredentials.has(credential.kind);
            const label = "MCP API Key";
            return (
              <article className="credential" key={credential.kind}>
                <div>
                  <h3>{label}</h3>
                  <p>{relayText("用于 Agent 连接 /mcp")}</p>
                </div>
                <div className="credential-value"><code>{revealed ? credential.token : `••••••••••••${credential.token.slice(-6)}`}</code></div>
                <p className="credential-time">{relayText("最近轮转：")}{new Date(credential.updatedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US")}</p>
                <div className="credential-actions">
                  <button className="secondary" onClick={() => data.toggleCredentialReveal(credential.kind)}>{revealed ? relayText("隐藏") : relayText("显示")}</button>
                  <button className="secondary" onClick={() => void data.copyCredential(credential)}>{relayText("复制")}</button>
                  <button className="rotate" onClick={() => void data.rotateCredential(credential.kind)}>{relayText("轮转")}</button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {data.runtimeSettings && (
        <RuntimeSettingsPanel
          settings={data.runtimeSettings}
          api={data.api}
          onSaved={(next) => {
            data.setRuntimeSettings(next);
            data.setMessage(relayText("运行设置已保存，新请求将使用最新配置"));
          }}
        />
      )}
    </>
  );
}
