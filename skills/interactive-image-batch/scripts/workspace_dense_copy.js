function getWorkspaceDenseCopy(stage) {
  const key = String(stage || '').trim() || 'home';
  const shared = {
    guideSummaryTitle: '工作台使用摘要',
    guideSummaryCopy: '新手先看这两条就够了，完整规则放到进阶查看。',
    visibilitySummaryTitle: '这页先看摘要',
    visibilitySummaryCopy: '默认先看关键内容，其它说明需要时再展开。',
    guideSectionTitle: '工作台使用规则',
    visibilitySectionTitle: '这页先看什么',
    supportGroupCopy: '这里只留继续推进时最可能临时回看的补充内容。',
    advancedGroupCopy: '这里只留需要复看或深看时才会用到的补充内容。',
    guideSectionCopy: '这页只说明主入口、这一站负责什么，以及哪些内容先后退。',
    visibilitySectionCopy: '这页只说明先看什么、按需再看什么、哪些内容先后退。',
    optionalEntryValue: '按需再看',
    optionalEntrySummary: '这里只留按需入口，不抢当前主动作。',
    storyboardEntryValue: '按需再看',
    storyboardEntrySummary: '只有需要对照镜头上下文时，再从这里进入。',
    runRecordEntryValue: '按需再看',
    runRecordEntrySummary: '只在想翻完整记录时再打开。',
    routeCurrentSummary: '这一块只负责说明当前这一站在做什么，不再展开重复细节。',
    routeBackSummary: '只有需要回看上一站判断时，再回去。',
    contextPrimaryHint: '当前只沿主链继续，不需要自己从旧页面里猜下一步。',
    directionSectionTitle: '当前方向',
    directionSectionCopy: '这里只保留这一轮真正影响执行的方向信息。',
    readinessSectionTitle: '当前放行判断',
    readinessSectionCopy: '先把放行判断看清，确认后再进入执行。',
    assetsSectionTitle: '素材约束',
    assetsSectionCopy: '这里只保留这一轮真正影响执行的素材绑定和约束。',
    previewSectionTitle: '结果总览',
    previewSectionCopy: '先看图，再决定保留、复核还是转异常处理。',
    issuesSectionTitle: '问题与复核',
    issuesSectionCopy: '这里只留会影响去留判断的问题项。',
    rerunSectionTitle: '补跑候选',
    rerunSectionCopy: '这里只列出已经进入补跑判断范围的对象。',
    contentSectionOrder: ['guide', 'visibility'],
  };

  const map = {
    home: {
      guideSummaryCopy: '新手先看这两条就够了：首页先沿主链走，完整规则放到进阶查看。',
      guideSectionCopy: '工作台首页负责总览当前阶段、下一步和异常压力。',
      visibilitySectionCopy: '首页只说明先看阶段和入口，其它内容默认后退。',
      optionalEntrySummary: '这里只留补充入口，不抢首页当前主判断。',
      routeCurrentSummary: '首页只负责统一判断下一站，不在这里展开细节操作。',
      routeBackSummary: '只有想切换任务时，再回入口层。',
      contextPrimaryHint: '首页只负责把你送到当前该去的那一站，不需要自己回旧页面猜下一步。',
      contentSectionOrder: ['preview', 'guide', 'visibility'],
    },
    prepare: {
      guideSummaryCopy: '新手先看这两条就够了：先确认方向和放行，再决定是否开跑。',
      visibilitySummaryCopy: '默认先看方向、放行和素材，其它说明需要时再展开。',
      guideSectionCopy: '准备页只说明这一步负责什么，以及哪些说明已经后退。',
      visibilitySectionCopy: '准备页只说明先看方向、放行和素材，其它内容默认后退。',
      directionSectionTitle: '任务方向',
      directionSectionCopy: '这里只保留这一轮真正影响执行的方向信息，让你先把任务方向看清。',
      readinessSectionTitle: '执行前检查',
      readinessSectionCopy: '先把放行判断看清，确认后再进入执行。',
      assetsSectionTitle: '素材绑定',
      assetsSectionCopy: '这里只保留这一轮真正影响执行的素材绑定和约束。',
      optionalEntrySummary: '这里只留补充入口，不抢准备层当前主动作。',
      routeCurrentSummary: '准备页只负责方向、放行和素材判断，不在这里扩散到其它页面。',
      routeBackSummary: '只有需要回看总览判断时，再回首页。',
      contextPrimaryHint: '准备页只负责把这一轮放行判断收清，不需要自己回旧准备页里猜下一步。',
      contentSectionOrder: ['direction', 'readiness', 'assets', 'guide', 'visibility'],
    },
    result: {
      guideSummaryCopy: '新手先看这两条就够了：先看结果判断，再决定保留、复核还是转异常。',
      visibilitySummaryCopy: '默认先看结果和问题项，其它说明需要时再展开。',
      guideSectionCopy: '结果页只说明这一步负责什么，以及哪些说明已经后退。',
      visibilitySectionCopy: '结果工作台只保留和筛图、取舍、继续推进有关的内容，其它内容默认后退。',
      previewSectionTitle: '结果总览',
      previewSectionCopy: '先看图，再决定保留、复核还是转异常处理。',
      issuesSectionTitle: '问题与复核',
      issuesSectionCopy: '这里只留会影响去留判断的问题项。',
      optionalEntrySummary: '这里只留补充入口，不抢结果层当前主动作。',
      routeCurrentSummary: '这一页只负责筛图、取舍和问题分流。',
      routeBackSummary: '只有想重新总览整轮主链时，再回首页。',
      contextPrimaryHint: '这一页只负责看图、取舍和问题分流，不再重复首页总控。',
      contentSectionOrder: ['preview', 'issues', 'guide', 'visibility'],
    },
    exception: {
      guideSummaryCopy: '新手先看这两条就够了：先把会挡主链的问题收掉，再决定回哪一站。',
      visibilitySummaryCopy: '默认先看失败、复核和补跑对象，其它说明需要时再展开。',
      guideSectionCopy: '异常页只说明这一步负责什么，以及哪些说明已经后退。',
      visibilitySectionCopy: '异常工作台只保留真正会影响主链继续的问题，其它内容默认后退。',
      issuesSectionTitle: '问题与复核',
      issuesSectionCopy: '这里只留真正会挡住主链继续的问题项。',
      rerunSectionTitle: '补跑候选',
      rerunSectionCopy: '这里只列出已经进入补跑判断范围的对象。',
      optionalEntrySummary: '这里只留补充入口，不抢异常层当前主动作。',
      routeCurrentSummary: '这一页只负责归类问题、判断去留和决定是否补跑。',
      routeBackSummary: '需要重新对照结果取舍时，再回结果工作台。',
      contextPrimaryHint: '这一页只负责把问题集中处理，处理完再回主链。',
      contentSectionOrder: ['issues', 'rerun', 'guide', 'visibility'],
    },
  };

  return {
    ...shared,
    ...(map[key] || map.home),
  };
}

function getWorkspaceContextDenseCopy(stage) {
  const key = String(stage || '').trim() || 'home';
  const shared = {
    flowLabel: '流程位置',
    hintLimit: 2,
    defaultFlowValue: '',
  };

  const map = {
    home: {
      defaultFlowValue: '当前任务 -> 工作台首页 -> 准备工作台 / 结果工作台 / 异常工作台',
      counts: [
        { label: '当前重点', field: 'focus' },
        { label: '当前阶段', field: 'stage' },
        { label: '下一步', field: 'next' },
        { label: '当前压力', field: 'pressure' },
      ],
    },
    prepare: {
      counts: [
        { label: '当前重点', field: 'focus' },
        { label: '放行判断', field: 'status' },
        { label: '素材约束', field: 'assets' },
        { label: '当前压力', field: 'pressure' },
      ],
    },
    result: {
      counts: [
        { label: '当前重点', field: 'focus' },
        { label: '当前结论', field: 'status' },
        { label: '下一步', field: 'next' },
        { label: '当前压力', field: 'pressure' },
      ],
    },
    exception: {
      counts: [
        { label: '当前重点', field: 'focus' },
        { label: '当前结论', field: 'status' },
        { label: '下一步', field: 'next' },
        { label: '当前压力', field: 'pressure' },
      ],
    },
  };

  return {
    ...shared,
    ...(map[key] || map.home),
  };
}

module.exports = {
  getWorkspaceDenseCopy,
  getWorkspaceContextDenseCopy,
};
