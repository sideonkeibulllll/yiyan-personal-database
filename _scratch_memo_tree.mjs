/**
 * 探针：打印 markdown 语法树，确认 Task / 有序列表节点结构
 * 用法：node _scratch_memo_tree.mjs
 */
import { markdownLanguage } from '@codemirror/lang-markdown';

const doc = [
  '- [ ] 任务A',
  '- [x] 任务B',
  '- 无序项',
  '1. 有序1',
  '2. 有序2',
  '   - 嵌套',
  '',
  '> 引用一行',
  '',
  '## 标题二',
].join('\n');

const tree = markdownLanguage.parser.parse(doc);

// 逐行打印 节点名 [文本]
const cursor = tree.cursor();
const walk = (c, depth) => {
  const text = doc.slice(c.from, c.to).replace(/\n/g, '\\n');
  console.log(`${'  '.repeat(depth)}${c.name}  (${c.from}-${c.to})  «${text}»`);
  if (c.firstChild()) {
    do { walk(c, depth + 1); } while (c.nextSibling());
    c.parent();
  }
};
walk(cursor, 0);
