const path = require('path');
const { ok } = require('../response');
const { all, rowsToObjects, createExport, createSnapshot, createJob, updateJobStatus } = require('../../db/repository');
const { writeJson } = require('../../shared/workspace');

async function createReport(ctx) {
  const jobId = createJob(ctx.db, ctx.projectId, 'export_report', { source: 'workbench' });
  updateJobStatus(ctx.db, ctx.projectId, jobId, 'running', { startedAt: new Date().toISOString() });
  const assets = rowsToObjects(all(ctx.db, 'SELECT * FROM assets WHERE project_id = ? ORDER BY updated_at DESC', [ctx.projectId]));
  const runs = rowsToObjects(all(ctx.db, 'SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC', [ctx.projectId]));
  const issues = rowsToObjects(all(ctx.db, 'SELECT * FROM issues WHERE project_id = ? ORDER BY updated_at DESC', [ctx.projectId]));
  const report = {
    generatedAt: new Date().toISOString(),
    projectId: ctx.projectId,
    counts: { runs: runs.length, assets: assets.length, issues: issues.length },
    runs,
    assets,
    issues,
  };
  const reportPath = path.join(ctx.outputDir, 'assets', 'exports', 'workbench_report.json');
  writeJson(reportPath, report);
  createSnapshot(ctx.outputDir, 'export_report', report);
  const exportId = createExport(ctx.db, ctx.projectId, 'report', '工作台报告', 'assets/exports/workbench_report.json', report.counts);
  updateJobStatus(ctx.db, ctx.projectId, jobId, 'succeeded', {
    result: { exportId, path: 'assets/exports/workbench_report.json' },
    completedAt: new Date().toISOString(),
  });
  return { exportId, jobId, path: 'assets/exports/workbench_report.json', report };
}

async function createSelectedPack(ctx) {
  const jobId = createJob(ctx.db, ctx.projectId, 'export_pack', { source: 'workbench' });
  updateJobStatus(ctx.db, ctx.projectId, jobId, 'running', { startedAt: new Date().toISOString() });
  const selected = rowsToObjects(all(ctx.db, `
    SELECT assets.* FROM assets
    JOIN selections ON selections.asset_id = assets.id
    WHERE assets.project_id = ? AND selections.state = 'selected'
    ORDER BY selections.updated_at DESC
  `, [ctx.projectId]));
  const pack = { generatedAt: new Date().toISOString(), projectId: ctx.projectId, selectedAssets: selected };
  const packPath = path.join(ctx.outputDir, 'assets', 'exports', 'selected_pack_manifest.json');
  writeJson(packPath, pack);
  createSnapshot(ctx.outputDir, 'export_pack', pack);
  const exportId = createExport(ctx.db, ctx.projectId, 'pack', '已选资产包清单', 'assets/exports/selected_pack_manifest.json', { selected: selected.length });
  updateJobStatus(ctx.db, ctx.projectId, jobId, 'succeeded', {
    result: { exportId, path: 'assets/exports/selected_pack_manifest.json', selected: selected.length },
    completedAt: new Date().toISOString(),
  });
  return { exportId, jobId, path: 'assets/exports/selected_pack_manifest.json', selected: selected.length };
}

async function routeExports(ctx, req, res) {
  if (req.method === 'GET' && ctx.pathname === '/api/exports') {
    const rows = all(ctx.db, 'SELECT * FROM exports WHERE project_id = ? ORDER BY created_at DESC', [ctx.projectId]);
    ok(res, rowsToObjects(rows));
    return true;
  }
  if (req.method === 'POST' && ctx.pathname === '/api/exports/report') {
    ok(res, await createReport(ctx), 201);
    return true;
  }
  if (req.method === 'POST' && ctx.pathname === '/api/exports/pack') {
    ok(res, await createSelectedPack(ctx), 201);
    return true;
  }
  return false;
}

module.exports = { routeExports, createReport, createSelectedPack };
