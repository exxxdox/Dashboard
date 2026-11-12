import { useRelayT } from "../i18n";
import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";

/** 各页面共用的展示组件：页面头、区块头、状态与表单控件。 */

export type PageHeaderProps = {
  title: string;
  description: string;
  actions?: ReactNode;
};

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export type SectionHeaderProps = {
  title: string;
  description: string;
  action?: string;
  onAdd?: () => void;
  secondaryAction?: string;
  onSecondary?: () => void;
  secondaryDisabled?: boolean;
};

export function SectionHeader({ title, description, action, onAdd, secondaryAction, onSecondary, secondaryDisabled }: SectionHeaderProps) {
  return (
    <div className="section-heading">
      <div><h2>{title}</h2><p>{description}</p></div>
      <div className="section-actions">
        {secondaryAction && onSecondary && <button className="secondary" onClick={onSecondary} disabled={secondaryDisabled}>{secondaryAction}</button>}
        {action && onAdd && <button className="secondary" onClick={onAdd}>＋ {action}</button>}
      </div>
    </div>
  );
}

export function Status({ enabled }: { enabled: boolean }) {
  const relayText = useRelayT();
  return <span className={enabled ? "status on" : "status"}><b />{enabled ? relayText("启用") : relayText("停用")}</span>;
}

export function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const relayText = useRelayT();
  return <div className="row-actions"><button onClick={onEdit}>{relayText("编辑")}</button><button className="danger" onClick={onDelete}>{relayText("删除")}</button></div>;
}

export function EmptyRow({ columns, text }: { columns: number; text: string }) {
  return <tr><td colSpan={columns} className="empty">{text}</td></tr>;
}

// 多行字段也传递默认值提示和长度限制，保证描述与普通输入采用相同的编辑规则。
export function Field({ label, multiline, ...props }: { label: string; multiline?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="field">
      <span>{label}</span>
      {multiline
        ? <textarea name={props.name} defaultValue={String(props.defaultValue ?? "")} required={props.required} placeholder={props.placeholder} maxLength={props.maxLength} />
        : <input {...props} />}
    </label>
  );
}

/**
 * 自绘下拉框，不用原生 <select>。
 *
 * 原生弹层由浏览器绘制，打开时把已选项放在指针下：鼠标移入列表先命中的
 * 仍是当前项，悬停也像在预选。这里列表在页面里，悬停只移动高亮，点击才选中。
 */
export function SelectField({ label, options, value, onValueChange, disabled }: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}) {
  const relayText = useRelayT();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const items = [{ value: "", label: relayText("请选择") }, ...options];
  const selectedIndex = items.findIndex((item) => item.value === value);
  const selected = items[selectedIndex];

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function openList(): void {
    setHighlight(Math.max(0, selectedIndex));
    setOpen(true);
  }

  function choose(index: number): void {
    const item = items[index];
    if (item) onValueChange(item.value);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const last = items.length - 1;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (open) setHighlight((current) => Math.min(current + 1, last));
        else openList();
        return;
      case "ArrowUp":
        event.preventDefault();
        if (open) setHighlight((current) => Math.max(current - 1, 0));
        else openList();
        return;
      case "Home":
        if (!open) return;
        event.preventDefault();
        setHighlight(0);
        return;
      case "End":
        if (!open) return;
        event.preventDefault();
        setHighlight(last);
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        if (open) choose(highlight);
        else openList();
        return;
      case "Escape":
        if (!open) return;
        event.preventDefault();
        setOpen(false);
        return;
      case "Tab":
        setOpen(false);
        return;
      default:
        return;
    }
  }

  return (
    <label className="field">
      <span>{label}</span>
      <div ref={containerRef} className="select-field">
        <div
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          aria-label={label}
          aria-activedescendant={open ? `${listId}-${highlight}` : undefined}
          aria-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : 0}
          className="select-trigger"
          onClick={() => { if (!disabled) (open ? setOpen(false) : openList()); }}
          onKeyDown={(event) => { if (!disabled) onKeyDown(event); }}
          onBlur={() => setOpen(false)}
        >
          <span className="select-value">{selected?.label}</span>
          <svg viewBox="0 0 24 24" aria-hidden className="select-chevron"><path d="m6 9 6 6 6-6" /></svg>
        </div>
        {open ? (
          <ul id={listId} role="listbox" aria-label={label} className="select-list">
            {items.map((item, index) => (
              <li
                key={`${item.value}-${index}`}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={item.value === value}
                data-highlight={index === highlight || undefined}
                // 焦点留在触发器上，点击才能在 onBlur 关闭列表前生效。
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(index)}
                className="select-option"
              >
                {item.label}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </label>
  );
}

export function Check({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <label className="check"><input {...props} type="checkbox" /><span>{label}</span></label>;
}
