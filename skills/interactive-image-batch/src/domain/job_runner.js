const path = require('path');
const { get, updateJobStatus, rowsToObjects } = require('../db/repository');

function rerunCommand(outputDir, payload = {}) {
  const resumeManifest = payload.resume_manifest || payload.resumeManifest || 'internal/local_execution_raw.json';
  const promptsFile = payload.prompts_file || payload.promptsFile || 'debug/prompts.generated.json';
  const args = [
    'node',
    'scripts/daoge.js',
    'rerun',
    '--output-dir',
    path.resolve(outputDir),
    '--prompts-file',
    path.join(path.resolve(outputDir), promptsFile),
    '--resume-manifest',
    path.join(path.resolve(outputDir), resumeManifest),
    '--failed-only',
    'true',
  ];
  if (payload.dry_run || payload.dryRun) args.push('--dry-run', 'true');
  return args.map((item) => (/\s/.test(item) ? JSON.stringify(item) : item)).join(' ');
}

function runJob(db, projectId, jobId, options = {}) {
  const job = get(db, 'SELECT * FROM jobs WHERE project_id = ? AND id = ?', [projectId, jobId]);
  if (!job) return null;
  if (job.status === 'cancelled') return rowsToObjects([job])[0];
  try {
    const payload = job.payload_json ? JSON.parse(job.payload_json) : {};
    let result = {};
    if (job.kind === 'rerun') {
      result = {
        command: rerunCommand(options.outputDir, payload),
        nextStep: '复制命令到终端执行，执行后刷新工作台同步新结果。',
        issueIds: payload.issue_ids || payload.issueIds || [],
      };
      updateJobStatus(db, projectId, jobId, 'queued', { result });
      return rowsToObjects([get(db, 'SELECT * FROM jobs WHERE project_id = ? AND id = ?', [projectId, jobId])])[0];
    } else {
      result = { message: '任务已记录' };
    }
    updateJobStatus(db, projectId, jobId, 'running', { startedAt: new Date().toISOString() });
    updateJobStatus(db, projectId, jobId, 'succeeded', {
      result,
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    updateJobStatus(db, projectId, jobId, 'failed', {
      error: error.message || String(error),
      completedAt: new Date().toISOString(),
    });
  }
  return rowsToObjects([get(db, 'SELECT * FROM jobs WHERE project_id = ? AND id = ?', [projectId, jobId])])[0];
}

function cancelJob(db, projectId, jobId) {
  const job = get(db, 'SELECT * FROM jobs WHERE project_id = ? AND id = ?', [projectId, jobId]);
  if (!job) return null;
  if (['succeeded', 'failed', 'cancelled'].includes(job.status)) return rowsToObjects([job])[0];
  updateJobStatus(db, projectId, jobId, 'cancelled', { completedAt: new Date().toISOString() });
  return rowsToObjects([get(db, 'SELECT * FROM jobs WHERE project_id = ? AND id = ?', [projectId, jobId])])[0];
}

module.exports = { runJob, cancelJob, rerunCommand };
