// 疑难处理页的文案与恢复指引。
//
// ⚠️ 这个文件在**创作者路径上**（不在 CONFIG_FACE_FILES / DOC_FACE_FILES 里，自动归 creator 面，
// 会被 tests/vnext/terminology-guard.test.js 扫）。所以正文必须零工程词。
//
// 唯一允许出现的工程字样是**命令本身** —— 它是要照抄进终端的，翻译成中文反而没法用。
// 处理方式和配置面「照抄型字段保留原文」同源：命令放在可复制的等宽块里，与正文视觉隔离，
// 并且**不写死参数细节**（参数会随版本变，写死了就会腐烂）；完整参数指向 `daoge help`。
//
// 命令名本身由测试锁住：tests/vnext/troubleshoot-model.test.js 会断言这里出现的每条
// 命令都在 src/vnext/cli/daoge.ts 的命令表里真实存在 —— 命令改名时测试先响。

export const TROUBLESHOOT_INTRO = '出问题的时候从这里开始。能自己看的先看；需要动数据的部分，只在本机命令行里做。';

export const DIAGNOSTIC_COPY = Object.freeze({
  title: '现在是什么状态',
  note: '先看这一块。多数「卡住了」到这里就能判断清楚，不用动数据。',
  refresh: '重新读一次',
  copy: '复制隐去隐私的诊断',
  restart: '安全重启后台任务',
  restartNote: '只在后台任务卡住时用。它不会动你的项目、素材和交付。',
  copyless: '这段诊断里没有密钥，也没有本机路径，可以直接发给别人看。'
});

export const BACKUP_COPY = Object.freeze({
  title: '数据还在不在',
  note: '这里只做只读的事：数一遍 Studio 里现在的素材和已交付文件，然后给你一份清单。清单只记文件的身份和大小，不含图片本身，也不含任何密钥。',
  action: '数一遍并导出清单',
  running: '正在清点',
  slow: '素材多的时候要等一会儿 —— 这一遍会逐个核对文件，慢是正常的。',
  done: '清单已经导出。',
  purpose: '拿它可以核对数据有没有缺、有没有变；迁移 Studio 或请人排查时，把它一起交出去。'
});

export const RECOVERY_COPY = Object.freeze({
  title: '怎么把数据找回来',
  guardrail: '恢复会重写整个 Studio 的数据，所以界面里刻意没有这个按钮 —— 浏览器上的一次误点代价太大。这件事只留给本机命令行：得真的有人在终端里把它敲下去。',
  readonly: 'Studio 负责只读的那一半：看状态、数一遍数据、导出清单、复制诊断。写数据的那一半交给命令行。',
  stepsTitle: '在本机终端里按顺序做',
  note: '清单不是文件路径，要从标准输入喂进去 —— 命令末尾那个 @- 就是这个意思。完整参数用 daoge help 查。'
});

// 每条命令都配一句人话，说明这一步会做什么、会不会动数据。
// 命令里刻意不写死参数细节（--workspace / --source-root 的取值因机器而异），只保留命令名，
// 让「命令名存在」这件事可以被测试锁住，而参数部分交给 daoge help。
export const RECOVERY_STEPS = Object.freeze([
  { purpose: '先导出当前 Studio 的清单，存成文件。只读。', command: 'daoge backup-manifest' },
  { purpose: '预演一次恢复：它会逐项核对备份和清单对不对得上，但不会写入任何东西。', command: 'daoge backup-restore-dry-run' },
  { purpose: '预演通过之后再真的恢复。中途失败会自动回滚到恢复前的状态。', command: 'daoge backup-restore' }
]);

export const RECOVERY_HELP_HINT = '每条命令的全部参数：daoge help';
