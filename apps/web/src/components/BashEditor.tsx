import { useEffect, useRef } from 'react';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { HighlightStyle, LRLanguage, bracketMatching, continuedIndent, delimitedIndent, indentNodeProp, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { parser } from '@fig/lezer-bash';
import { NodeProp } from '@lezer/common';
import { tags } from '@lezer/highlight';

const colors = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--accent-2)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--ok)' },
  { tag: tags.comment, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool], color: 'var(--warn)' },
  { tag: [tags.variableName, tags.special(tags.variableName)], color: 'var(--accent)' },
  { tag: [tags.name, tags.function(tags.variableName), tags.standard(tags.variableName)], color: 'var(--info)' },
]);

const bash = LRLanguage.define({
  parser: parser.configure({
    props: [
      // Bash expansion openers span two characters, so pair their syntax nodes explicitly.
      NodeProp.closedBy.add({ '(': [')'], '$(': [')'], '{': ['}'], '${': ['}'] }),
      NodeProp.openedBy.add({ ')': ['(', '$('], '}': ['{', '${'] }),
      indentNodeProp.add({
        IfClause: continuedIndent({ except: /^\s*(then|elif|else|fi)\b/ }),
        'WhileClause UntilClause ForClause': continuedIndent({ except: /^\s*(do|done)\b/ }),
        DoGroup: delimitedIndent({ closing: 'done' }),
        BraceGroup: delimitedIndent({ closing: '}' }),
        'Subshell CommandSubstitution': delimitedIndent({ closing: ')' }),
      }),
    ],
  }),
  languageData: {
    commentTokens: { line: '#' },
    indentOnInput: /^\s*(then|do|done|fi|else|elif|esac|\})$/,
  },
});

export const bashExtensions = [
  bash,
  indentUnit.of('  '),
  syntaxHighlighting(colors),
  indentOnInput(),
  bracketMatching(),
];

const theme = EditorView.theme({
  '&': { color: 'var(--text)', backgroundColor: 'var(--bg)', fontSize: '14px' },
  '&.cm-focused': { outline: '2px solid var(--accent-line)', outlineOffset: '-2px' },
  '.cm-scroller': { fontFamily: 'var(--stack-mono)', lineHeight: '1.6', overflow: 'auto', maxHeight: '420px' },
  '.cm-content': { padding: '10px 0', minHeight: '100%' },
  '.cm-line': { padding: '0 12px' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--faint)', borderColor: 'var(--border)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--accent-soft)' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--accent-line)' },
  '&.cm-focused .cm-matchingBracket, .cm-matchingBracket': { backgroundColor: 'var(--accent-line)', outline: '1px solid var(--accent)' },
}, { dark: true });

type BashEditorProps = {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  id?: string;
  label: string;
  describedBy?: string;
};

export function BashEditor({ value, onChange, readOnly = false, id, label, describedBy }: BashEditorProps) {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const options = useRef(new Compartment());
  const callback = useRef(onChange);
  const replacing = useRef(false);
  // The pinned file snapshot owns newline style, even while an edit contains no newline.
  const lineSeparator = useRef(value.includes('\r\n') ? '\r\n' : '\n');

  useEffect(() => { callback.current = onChange; }, [onChange]);
  useEffect(() => {
    if (!container.current) return;
    const editor = new EditorView({
      parent: container.current,
      state: EditorState.create({
        extensions: [
          ...bashExtensions, theme, lineNumbers(), EditorView.lineWrapping,
          EditorState.lineSeparator.of(lineSeparator.current),
          history(), drawSelection(), highlightActiveLine(), highlightActiveLineGutter(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          options.current.of([]),
          EditorView.updateListener.of(update => {
            if (update.docChanged && !replacing.current) callback.current?.(update.state.sliceDoc());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => { editor.destroy(); view.current = null; };
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    // Reconfigure in place so saving, locale changes and parent renders preserve selection and undo.
    const attributes: Record<string, string> = { 'aria-label': label, 'aria-multiline': 'true', 'aria-readonly': String(readOnly), tabindex: '0', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' };
    if (id) attributes.id = id;
    if (describedBy) attributes['aria-describedby'] = describedBy;
    editor.dispatch({ effects: options.current.reconfigure([
      EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly),
      EditorView.contentAttributes.of(attributes),
    ]) });
  }, [readOnly, id, label, describedBy]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.sliceDoc() === value) return;
    replacing.current = true;
    try {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
        annotations: Transaction.addToHistory.of(false),
      });
    } finally { replacing.current = false; }
  }, [value]);

  return <div ref={container} className="border-line min-w-0 overflow-hidden rounded-lg border [&_.cm-content]:min-h-40" />;
}
