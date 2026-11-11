import { EditorSelection, EditorState } from '@codemirror/state';
import { syntaxTree, matchBrackets, getIndentation } from '@codemirror/language';
import { insertNewlineAndIndent } from '@codemirror/commands';
import { expect, test } from 'vitest';
import { bashExtensions } from './BashEditor';

function state(doc: string, position = doc.length) {
  return EditorState.create({ doc, selection: EditorSelection.cursor(position), extensions: bashExtensions });
}

test('Bash parser recognizes keywords, strings and comments', () => {
  const tree = syntaxTree(state('if true; then\n  echo "hello" # greeting\nfi'));
  const tokens: string[] = [];
  tree.iterate({ enter: node => { tokens.push(node.name); } });
  expect(tokens).toContain('if');
  expect(tokens).toContain('String');
  expect(tokens).toContain('Comment');
});

test('Enter preserves indentation inside a Bash block', () => {
  let current = state('if true; then\n  echo hello');
  insertNewlineAndIndent({ state: current, dispatch: transaction => { current = transaction.state; } });
  expect(current.doc.toString()).toBe('if true; then\n  echo hello\n  ');
});

test('matches nested Bash brackets', () => {
  const doc = 'echo $(printf "%s" "hi")';
  const result = matchBrackets(state(doc), doc.indexOf('('), 1);
  expect(result?.matched).toBe(true);
  expect(result?.end?.from).toBe(doc.lastIndexOf(')'));
});

test.each(['if true; then', 'for x in a; do', 'foo() {'])('indents a new Bash block after %s', doc => {
  let current = state(doc);
  insertNewlineAndIndent({ state: current, dispatch: transaction => { current = transaction.state; } });
  expect(current.doc.toString()).toBe(`${doc}\n  `);
});


test.each([
  ['if true; then\n  echo hi\n  fi', 0],
  ['for x in a; do\n  echo hi\n  done', 0],
  ['foo() {\n  echo hi\n  }', 0],
  ['if true; then\n  if true; then\n    echo hi\n    fi\nfi', 2],
] as const)('aligns closing Bash blocks with their opener', (doc, expected) => {
  const current = state(doc);
  const line = doc.includes('    fi') ? current.doc.line(4) : current.doc.line(current.doc.lines);
  expect(getIndentation(current, line.from)).toBe(expected);
});
