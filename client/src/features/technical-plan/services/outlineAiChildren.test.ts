import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// @ts-expect-error allowImportingTsExtensions 仅影响测试运行方式
import { buildOutlineAiChildrenMessages, normalizeGeneratedChildren } from './outlineAiChildren.ts';

function createBalancedChildren(currentDepth: number, targetDepth: number, prefix = '主题'): unknown[] {
  return [1, 2].map((index) => {
    const title = `${prefix}${currentDepth}${index}`;
    if (currentDepth >= targetDepth) {
      return { title, description: `${title}的具体编写内容`, content_mode: 'ai-generate' };
    }
    return {
      title,
      description: `${title}的下级结构`,
      children: createBalancedChildren(currentDepth + 1, targetDepth, `${prefix}${index}`),
    };
  });
}

test('五级配置生成递归提示并把所有 AI 叶子编号到至少五级', () => {
  const messages = buildOutlineAiChildrenMessages({
    title: '施工组织方案',
    description: '施工组织总体要求',
    requirement: '按准备、实施和验收拆分',
    parentDepth: 1,
    minimumDepth: 5,
  });
  assert.match(String(messages[0]?.content), /递归 children/);
  assert.match(String(messages[0]?.content), /最低五级/);
  assert.match(String(messages[0]?.content), /最多七级/);

  const children = normalizeGeneratedChildren(
    { children: createBalancedChildren(2, 5) },
    { parentId: '1', parentDepth: 1, minimumDepth: 5, startIndex: 3 },
  );

  assert.equal(children[0].id, '1.3');
  assert.equal(children[1].id, '1.4');
  const leafIds: string[] = [];
  const visit = (items: typeof children) => items.forEach((item) => {
    if (item.children?.length) visit(item.children);
    else leafIds.push(item.id);
  });
  visit(children);
  assert.equal(leafIds.length, 16);
  assert.equal(leafIds.every((id) => id.split('.').length === 5), true);
});

test('默认配置允许生成两个直接 AI 叶子', () => {
  const children = normalizeGeneratedChildren({ children: [
    { title: '施工准备', description: '编写施工准备工作', content_mode: 'ai-generate' },
    { title: '质量验收', description: '编写质量验收方法', content_mode: 'ai-generate' },
  ] }, {
    parentId: '2.1',
    parentDepth: 2,
    minimumDepth: 0,
    startIndex: 1,
  });

  assert.deepEqual(children.map((item) => item.id), ['2.1.1', '2.1.2']);
  assert.equal(children.every((item) => item.content_mode === 'ai-generate'), true);
});

test('递归结果拒绝单子节点父级', () => {
  assert.throws(() => normalizeGeneratedChildren({ children: [
    {
      title: '实施阶段',
      description: '实施阶段内容',
      children: [{ title: '现场实施', description: '现场实施内容', content_mode: 'ai-generate' }],
    },
    { title: '验收阶段', description: '验收内容', content_mode: 'ai-generate' },
  ] }, {
    parentId: '1', parentDepth: 1, minimumDepth: 0, startIndex: 1,
  }), /至少包含两个子目录/);
});

test('递归结果拒绝同级重复标题和空泛标题', () => {
  assert.throws(() => normalizeGeneratedChildren({ children: [
    { title: '施工准备', description: '准备一', content_mode: 'ai-generate' },
    { title: '施工准备', description: '准备二', content_mode: 'ai-generate' },
  ] }, {
    parentId: '1', parentDepth: 1, minimumDepth: 0, startIndex: 1,
  }), /同级目录标题重复/);

  assert.throws(() => normalizeGeneratedChildren({ children: [
    { title: '详细说明', description: '说明内容', content_mode: 'ai-generate' },
    { title: '质量验收', description: '验收内容', content_mode: 'ai-generate' },
  ] }, {
    parentId: '1', parentDepth: 1, minimumDepth: 0, startIndex: 1,
  }), /标题过于空泛/);
});

test('递归结果拒绝超过七级或未达到最低层级的 AI 叶子', () => {
  assert.throws(() => normalizeGeneratedChildren({ children: createBalancedChildren(7, 8) }, {
    parentId: '1.1.1.1.1.1', parentDepth: 6, minimumDepth: 0, startIndex: 1,
  }), /最多七级/);

  assert.throws(() => normalizeGeneratedChildren({ children: [
    { title: '施工准备', description: '施工准备内容', content_mode: 'ai-generate' },
    { title: '质量验收', description: '质量验收内容', content_mode: 'ai-generate' },
  ] }, {
    parentId: '1', parentDepth: 1, minimumDepth: 5, startIndex: 1,
  }), /未达到最低五级/);
});

test('目录编辑页通过递归 service 生成并校验局部子树', () => {
  const source = fs.readFileSync(new URL('../pages/OutlineEditPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /buildOutlineAiChildrenMessages/);
  assert.match(source, /normalizeGeneratedChildren/);
  assert.match(source, /parentDepth:\s*selectedItemPath\.length/);
  assert.doesNotMatch(source, /不要生成 children/);
});
