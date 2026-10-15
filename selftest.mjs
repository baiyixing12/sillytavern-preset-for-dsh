/**
 * 自测：不靠 DSH 运行时，直接喂一个假 ctx 走 apply()，
 * 验证 预设加载 / 接口 / 按窗口状态 / ST 宏展开 是否正常。
 * 用法：node /root/dsh-st-preset/selftest.mjs
 */
import { apply } from './index.js';
import { existsSync, mkdirSync, rmSync, copyFileSync, readFileSync } from 'node:fs';

// 独立临时目录，避免污染真实 state.json
const DIR = '/tmp/st-preset-selftest';
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
copyFileSync('/root/.dsh/st-presets/智脑-Z（10.1）.json', `${DIR}/智脑-Z（10.1）.json`);

const sections = [];
const routes = [];
const listeners = new Map();

const fakeCtx = {
  logger: { info: (...a) => console.log('[info]', ...a), warn: (...a) => console.warn('[warn]', ...a) },
  inject: (services, callback) => {
    const child = { ...fakeCtx, connection: { registerFetchRoute: (owner, route) => routes.push(route) } };
    callback(child);
  },
  on: (event, handler) => { listeners.set(event, handler); },
  effect: (fn) => { const dispose = fn(); return () => dispose && dispose(); },
};

apply(fakeCtx, { presetsDir: DIR });

// 模拟一个窗口（Session）被创建
const agentCtx = {
  effect: (fn) => { const dispose = fn(); return () => dispose && dispose(); },
  systemPrompt: { section: (section) => { sections.push(section); return () => {}; } },
};
listeners.get('agent/created')({ agent: { id: 'session-test-1', ctx: agentCtx } });

const call = async (payload) => {
  const route = routes[0];
  const request = new Request('http://127.0.0.1:3080/api/st-preset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const response = await route.fetch(request);
  return response.json();
};

const fail = [];
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) fail.push(label);
};

const initial = await call({ action: 'state', sessionId: 'session-test-1' });
check('预设被发现', initial.presets.length === 1, JSON.stringify(initial.presets));
check('未选预设时不注入', sections[0].text() === '', JSON.stringify(sections[0].text().slice(0, 40)));
check('section 顺序/名字', sections[0].name === 'st-preset' && sections[0].order === 100);

const chosen = await call({ action: 'setPreset', sessionId: 'session-test-1', presetId: initial.presets[0].id });
check('面板条目被解析', chosen.detail.entries.length > 40, `${chosen.detail.entries.length} 条`);
const defaultOn = chosen.detail.entries.filter((e) => e.enabled).length;
check('默认开关来自 ST 快照', defaultOn > 20 && defaultOn < chosen.detail.entries.length, `${defaultOn} 开 / ${chosen.detail.entries.length} 条`);
check('空锚点不进面板', !chosen.detail.entries.some((e) => /系统锚点|Agent System Prompt/.test(e.name)));
check('分区信息存在', new Set(chosen.detail.entries.map((e) => e.section)).size >= 3,
  [...new Set(chosen.detail.entries.map((e) => e.section))].slice(0, 4).join(' / '));
check('🔀 多选一被识别', chosen.detail.entries.some((e) => e.group));

const rendered = sections[0].text();
check('正文已注入', rendered.length > 5000, `${rendered.length} 字`);
check('宏已全部展开', !/\{\{/.test(rendered));
check('setvar 未泄漏', !rendered.includes('setvar'));
check('工具调用轮同样读得到（每次组装现算）', typeof sections[0].text === 'function');

const target = chosen.detail.entries.find((e) => e.name.includes('NSFW'));
const off = await call({ action: 'toggle', sessionId: 'session-test-1', identifier: target.identifier, enabled: false });
check('关闭条目后状态变更', off.detail.entries.find((e) => e.identifier === target.identifier).enabled === false);
check('关闭后正文字数下降', sections[0].text().length < rendered.length,
  `${rendered.length} → ${sections[0].text().length}`);

const other = await call({ action: 'state', sessionId: 'another-window' });
check('另一窗口不受影响（按窗口隔离）', other.presetId === null && sections[0].text().length > 5000);

const exclusive = chosen.detail.entries.find((e) => e.group && !e.enabled);
if (exclusive) {
  const picked = await call({
    action: 'toggle', sessionId: 'session-test-1', identifier: exclusive.identifier,
    enabled: true, exclusiveGroup: exclusive.group,
  });
  const sameGroup = picked.detail.entries.filter((e) => e.group === exclusive.group && e.enabled);
  check('多选一组内只剩一个', sameGroup.length === 1, sameGroup.map((e) => e.name).join(' | '));
}

const restored = await call({ action: 'clearOverrides', sessionId: 'session-test-1' });
check('还原后回到 ST 默认', restored.detail.entries.filter((e) => e.enabled).length === defaultOn);


// ---- 导入 / 删除（自由更换预设）----
const mini = JSON.stringify({
  name: '迷你测试预设',
  prompts: [{ identifier: 'a', name: 'A', content: 'AAA {{setvar::x::B}}', role: 'system' },
            { identifier: 'b', name: 'B', content: '{{getvar::x}}', role: 'system' }],
  prompt_order: [{ order: [{ enabled: true, identifier: 'a' }, { enabled: true, identifier: 'b' }] }],
});
const imported = await call({ action: 'import', sessionId: 'session-test-1', fileName: '迷你测试预设.json', text: mini });
check('导入后出现在列表', imported.presets.some((p) => p.id === '迷你测试预设'), JSON.stringify(imported.presets.map((p) => p.id)));
check('导入后自动选中', imported.presetId === '迷你测试预设' && imported.imported === '迷你测试预设');
check('导入后正文来自新预设', sections[0].text() === 'AAA\n\nB', JSON.stringify(sections[0].text()));
check('文件真的落盘', existsSync(`${DIR}/迷你测试预设.json`));

const again = await call({ action: 'import', sessionId: 'session-test-1', fileName: '迷你测试预设.json', text: mini });
check('重复导入返回冲突', again.conflict === '迷你测试预设');
const forced = await call({ action: 'import', sessionId: 'session-test-1', fileName: '迷你测试预设.json', text: mini, overwrite: true });
check('确认后可覆盖', forced.imported === '迷你测试预设' && !forced.conflict);

const bad = await call({ action: 'import', sessionId: 'session-test-1', fileName: 'x.json', text: '{"hello":1}' });
check('非 ST 预设被拒', typeof bad.error === 'string', bad.error);
const traversal = await call({ action: 'import', sessionId: 'session-test-1', fileName: '../../evil.json', text: mini });
check('路径穿越被净化', traversal.imported === 'evil' && existsSync(`${DIR}/evil.json`) && !existsSync('/tmp/evil.json'),
  traversal.imported);

const removed = await call({ action: 'delete', sessionId: 'session-test-1', presetId: '迷你测试预设' });
check('删除后从列表消失', !removed.presets.some((p) => p.id === '迷你测试预设'));
check('删的不是当前选中，窗口不动', removed.presetId === 'evil', `presetId=${JSON.stringify(removed.presetId)}`);
const removedCurrent = await call({ action: 'delete', sessionId: 'session-test-1', presetId: 'evil' });
check('删掉当前选中后回落未选', removedCurrent.presetId === null, `presetId=${JSON.stringify(removedCurrent.presetId)}`);
check('删除只动目标文件', existsSync(`${DIR}/智脑-Z（10.1）.json`));
const removeTraversal = await call({ action: 'delete', sessionId: 'session-test-1', presetId: '../智脑-Z（10.1）' });
check('删除拒绝非法 id', typeof removeTraversal.error === 'string', removeTraversal.error);
rmSync(`${DIR}/evil.json`, { force: true });


// ---- 条目正文就地编辑 / 预设改名 ----
const zhinaoId = '智脑-Z（10.1）';
await call({ action: 'setPreset', sessionId: 'session-test-1', presetId: zhinaoId });
const before = await call({ action: 'entryText', sessionId: 'session-test-1', identifier: 'main' });
check('entryText 给出原文', before.edited === false && before.text.length > 50, `${before.text.length} 字`);

const edited = await call({ action: 'setText', sessionId: 'session-test-1', identifier: 'main', text: 'OVERRIDE-正文' });
check('setText 后标记已改', edited.detail.entries.find((e) => e.identifier === 'main').edited === true);
check('setText 后正文被替换', sections[0].text().includes('OVERRIDE-正文'));
check('编辑只作用于本窗口', (await call({ action: 'state', sessionId: 'session-other' })).presetId === null);
check('entryText 回读覆盖内容', (await call({ action: 'entryText', sessionId: 'session-test-1', identifier: 'main' })).text === 'OVERRIDE-正文');

const back = await call({ action: 'setText', sessionId: 'session-test-1', identifier: 'main', text: null });
check('可还原成原文', back.detail.entries.find((e) => e.identifier === 'main').edited === false
  && !sections[0].text().includes('OVERRIDE-正文'));

const renamed = await call({ action: 'rename', sessionId: 'session-test-1', presetId: zhinaoId, name: '智脑·改名测试' });
check('改名后下拉名变化', renamed.presets.find((p) => p.id === zhinaoId).name === '智脑·改名测试');
check('改名写回预设文件', JSON.parse(readFileSync(`${DIR}/${zhinaoId}.json`, 'utf8')).name === '智脑·改名测试');
check('改名不动 id/文件名', existsSync(`${DIR}/${zhinaoId}.json`));
await call({ action: 'rename', sessionId: 'session-test-1', presetId: zhinaoId, name: '智脑-Z（10.1）' });
check('改名可逆', (await call({ action: 'state', sessionId: 'session-test-1' })).presets.find((p) => p.id === zhinaoId).name === '智脑-Z（10.1）');
check('改名拒绝非法 id', Boolean((await call({ action: 'rename', sessionId: 'session-test-1', presetId: '../x', name: 'x' })).error));
check('改名拒绝空名', Boolean((await call({ action: 'rename', sessionId: 'session-test-1', presetId: zhinaoId, name: '   ' })).error));

console.log(fail.length === 0 ? '\n全部通过' : `\n失败 ${fail.length} 项：${fail.join(', ')}`);
process.exit(fail.length === 0 ? 0 : 1);
