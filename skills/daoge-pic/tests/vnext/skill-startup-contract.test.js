const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const skillRoot = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(skillRoot, relativePath), 'utf8');
const skill = read('SKILL.md');
const readme = read('README.md');
const spec = read('docs/daoge_pic_vnext_upgrade_spec_zh.md');
const evidence = read('docs/vnext_verification_evidence_zh.md');

function markdownSection(markdown, heading) {
  const start = markdown.indexOf(heading);
  assert.notEqual(start, -1, `missing heading: ${heading}`);
  const level = heading.match(/^#+/)[0].length;
  const remainder = markdown.slice(start + heading.length);
  const nextHeading = new RegExp(`\\n#{1,${level}} `).exec(remainder);
  return markdown.slice(start, nextHeading ? start + heading.length + nextHeading.index : markdown.length);
}

function assertOrdered(text, markers) {
  let previous = -1;
  for (const marker of markers) {
    const current = text.indexOf(marker);
    assert.ok(current > previous, `expected ordered marker: ${marker}`);
    previous = current;
  }
}

function assertSessionOpenSemantics(text, label) {
  assert.match(text, /每个独立智能体会话[^。\n]*普通 `node scripts\/daoge\.js open --workspace <path>`/, `${label} must require an ordinary open for every independent agent session`);
  assert.ok(text.includes('去重') && text.includes('daemon') && text.includes('presence/open-claim'), `${label} must assign cross-session deduplication to daemon presence/open-claim`);
  assert.match(text, /首个[^。\n]*(?:opener|默认浏览器)/, `${label} must allow only the first claim holder to invoke the opener`);
}

test('Skill startup protocol classifies triggers and opens before session context or clarification', () => {
  const protocol = markdownSection(skill, '## 执行型启动协议（MUST）');
  const classification = markdownSection(protocol, '### 触发分类');
  const startup = markdownSection(protocol, '### 首次启动顺序');
  const workflow = markdownSection(skill, '## 会话工作法');

  assert.match(classification, /执行型触发[\s\S]*daoge-pic \/ 刀哥生图[\s\S]*生成、编辑、衍生[\s\S]*Generation History[\s\S]*恢复、重试或取消[\s\S]*交付/);
  assert.match(classification, /咨询\/开发型触发[\s\S]*架构、配置、源码、文档、测试[\s\S]*不得自动启动 Studio 或打开 Workbench/);
  assert.match(startup, /已有明确绑定时复用[\s\S]*只询问这一项前置条件/);
  assert.match(startup, /不得使用临时目录、Skill 安装目录或任意当前目录/);
  assertOrdered(startup, [
    '1. 先判断触发类型',
    '2. 执行型触发先解析',
    '3. 每个独立智能体会话',
    'node scripts/daoge.js open --workspace <path>',
    '4. `open` 返回',
    '随后才创建或恢复',
    '然后开始创作澄清'
  ]);
  assert.match(startup, /确保同工作区唯一健康 daemon[\s\S]*opener claim[\s\S]*首个 claim 持有者[\s\S]*opened:false, reused:true/);
  assert.match(startup, /不是外部 Provider 调用[\s\S]*不需要生成确认[\s\S]*不得自动执行 Provider 连接测试/);
  assertOrdered(workflow, ['先完成“执行型启动协议”', '再澄清目标']);
  assert.doesNotMatch(workflow, /1\. 先澄清/);
});

test('Skill cross-conversation reuse, safe fallback, unconfigured Provider, and startup report remain explicit', () => {
  const protocol = markdownSection(skill, '## 执行型启动协议（MUST）');
  const reuse = markdownSection(protocol, '### 跨会话复用');
  const fallback = markdownSection(protocol, '### 打开失败与安全访问');
  const provider = markdownSection(protocol, '### Provider 未配置');
  const report = markdownSection(protocol, '### 首次状态汇报');

  assert.match(reuse, /每个独立智能体会话[\s\S]*调用普通 `open`[\s\S]*daemon[\s\S]*presence\/open-claim/);
  assert.match(reuse, /活动 Workbench[\s\S]*最近认证连接[\s\S]*未过期 claim[\s\S]*不调用 OS opener/);
  assert.match(reuse, /open --force true[\s\S]*用户明确要求[\s\S]*普通启动不得 force/);
  assert.match(reuse, /不承诺 OS opener[\s\S]*普通 open 最多触发一个实际 opener/);

  assert.match(fallback, /daemon 健康[\s\S]*node scripts\/daoge\.js open --workspace <path>[\s\S]*npx daoge open --workspace <path>/);
  assert.match(fallback, /不得回显或要求用户复制 bootstrap URL、capability、Cookie、session token/);
  assert.match(fallback, /裸 Workbench origin 也不得作为主要访问方式/);
  assert.doesNotMatch(fallback, /https?:\/\//);
  assert.doesNotMatch(fallback, /#capability=/);

  assert.match(provider, /没有 active Provider Profile 不阻止 Studio 启动或 Workbench 打开/);
  assert.match(provider, /Workbench 的生成服务页配置并激活 Profile[\s\S]*回到会话继续/);
  assert.match(provider, /不得自动测试连接[\s\S]*用户明确发起的连接测试/);

  for (const field of ['Studio 已启动或已连接', '已在默认浏览器打开', '已复用现有 Workbench', 'Provider readiness', '当前项目/任务/轮次', '下一步']) {
    assert.ok(report.includes(field), `startup report must include ${field}`);
  }
  for (const responsibility of ['会话中描述和确认创作', 'Provider、素材、Generation History、选片和交付']) {
    assert.ok(report.includes(responsibility), `startup report must explain ${responsibility}`);
  }
  assert.match(report, /opened:true[\s\S]*reused:true[\s\S]*不得把 reused 谎报为新打开/);
});

test('README and authoritative specification preserve the same session-first startup contract', () => {
  const readmeStartup = markdownSection(readme, '### 会话优先的启动顺序');
  const specStartup = markdownSection(spec, '### 4.1 主交互链路与执行型启动协议');
  const combined = `${readmeStartup}\n${specStartup}`;
  for (const [label, startup] of [['README', readmeStartup], ['specification', specStartup]]) {
    assertSessionOpenSemantics(startup, label);
  }

  for (const contract of [
    /执行型触发[\s\S]*咨询\/开发型/,
    /稳定工作区[\s\S]*(临时目录|任意 cwd|任意当前目录)/,
    /open --workspace <path>[\s\S]*Studio Session[\s\S]*创作澄清/,
    /opened:true[\s\S]*reused:true/,
    /opener[\s\S]*(不能保证|不得声称|不承诺)[\s\S]*(聚焦|标签)/,
    /daemon 健康[\s\S]*安全[\s\S]*open --workspace <path>/,
    /bootstrap URL[\s\S]*capability[\s\S]*(Cookie|session token)/,
    /Provider Profile 不阻止 Studio[\s\S]*不得自动(?:连接)?测试/,
    /Provider readiness[\s\S]*当前项目\/任务\/轮次[\s\S]*下一步/
  ]) {
    assert.match(combined, contract);
  }
  assert.doesNotMatch(`${skill}\n${readme}\n${spec}`, /自动打开或聚焦同一个 Workbench/);
  assert.doesNotMatch(`${skill}\n${readme}\n${spec}\n${evidence}`, /同一会话[^\n]{0,80}(?:不得再次|不重复调用) `open`/);
  assert.doesNotMatch(`${skill}\n${readme}\n${spec}\n${evidence}`, /避免重复标签(?:页)?(?:的机制|依靠)[^\n]*不重复调用 `open`/);
  assert.doesNotMatch(`${skill}\n${readme}\n${spec}`, /先澄清目标[^\n]*\n(?:.*\n){0,3}.*open --workspace/);
});

test('5.9.1 is the stable GitHub Release contract while 5.9.0 remains immutable history', () => {
  const packageJson = JSON.parse(read('package.json'));
  const packageLock = JSON.parse(read('package-lock.json'));
  const currentDocs = `${skill}\n${readme}\n${spec}`;

  assert.equal(packageJson.version, '5.9.1');
  assert.equal(packageLock.version, '5.9.1');
  assert.equal(packageLock.packages[''].version, '5.9.1');
  for (const document of [skill, readme, evidence]) {
    assert.match(document, /5\.9\.1/);
  }
  assert.match(`${skill}\n${readme}`, /稳定正式版本[^。\n]{0,120}5\.9\.1/);
  assert.doesNotMatch(`${skill}\n${readme}`, /5\.9\.1[^。\n]{0,80}尚未发布/);
  assert.doesNotMatch(`${skill}\n${readme}`, /稳定正式发布(?:仍)?(?:为|是)[^。\n]*5\.9\.0/);
  assert.match(readme, /daoge-pic-v5\.9\.1\/daoge-pic-5\.9\.1\.tgz/);
  assert.match(readme, /GitHub[^。\n]*资产[^。\n]*不表示[^。\n]*npm registry/);

  assert.match(evidence, /## 1\. daoge-pic 5\.7\.0 已发布历史证据[\s\S]*daoge-pic-5\.7\.0\.tgz[\s\S]*1fb70265f4a0e7e5858be3dec7cf21ad8706c720fede7c1712e74a36678110fe/);
  const historicalEvidence = markdownSection(evidence, '## 6. daoge-pic 5.9.0 发布验证证据');
  assert.match(historicalEvidence, /daoge-pic-v5\.9\.0[\s\S]*GitHub Release[^\n]*\.tgz/);
  const releaseEvidence = markdownSection(evidence, '## 7. daoge-pic 5.9.1 发布验证证据');
  assert.match(releaseEvidence, /daoge-pic-v5\.9\.1[\s\S]*GitHub Release[\s\S]*项目资产[\s\S]*shared_across_projects/);
  assert.match(releaseEvidence, /0 vulnerabilities[\s\S]*未调用真实图片 Provider/);
  assert.doesNotMatch(releaseEvidence, /5\.9\.1 仍为尚未发布候选|不宣称 GitHub Release/);
});
