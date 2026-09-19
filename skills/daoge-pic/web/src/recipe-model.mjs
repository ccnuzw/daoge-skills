/**
 * 「我的配方」的领域逻辑（方案 9.6 · 施工单 M1 / 决策 D4）。纯函数，可单测。
 *
 * 创作里「可用的配置」反复出现，但用户侧没有复用的入口（`confirmed_templates` / `style_kits` /
 * `brand_kits` 的底子都在，却都是给 agent 的定义）。配方就是把**一次可用的配置**存下来，
 * 下次发起时**带出来**。
 *
 * 两条边界写死（决策 D4）：
 *   - **带出 ≠ 自动执行**：配方只把「起点」放好，仍要人确认才出图；
 *   - **带出可改**：带出来的是草稿，不是命令。
 */

/** 配方名：没有名字的配方在列表里认不出来。 */
function recipeName(input = {}) {
  const fromTask = typeof input.task?.name === 'string' ? input.task.name.trim() : '';
  const fromPrompt = typeof input.plan?.prompt === 'string' ? input.plan.prompt.trim() : '';
  const base = fromTask || fromPrompt.slice(0, 12) || '我的配方';
  return base + ' · 配方';
}

/**
 * 从一个可用批次里存出配方草稿（跨项目复用）。
 * @param {{ plan?: any, task?: any }} [input]
 */
export function recipeDraftFrom(input = {}) {
  const plan = input.plan || {};
  const aspect = (plan.output && typeof plan.output === 'object' ? plan.output.aspectRatio : '') || plan.aspectRatio || '';
  const count = Number.isFinite(Number(plan.itemCount)) ? Number(plan.itemCount) : (Number.isFinite(Number(plan.targetCount)) ? Number(plan.targetCount) : null);
  const definition = {
    prompt: typeof plan.prompt === 'string' ? plan.prompt : '',
    ...(count ? { itemCount: count } : {}),
    ...(aspect ? { aspectRatio: String(aspect) } : {}),
    kind: 'user-recipe'
  };
  return { name: recipeName({ task: input.task, plan }), definition };
}

/**
 * 下次发起时的「带出」：给的是**可改的起点**，不是执行命令。
 * @param {{ recipes?: any[], brief?: string }} [input]
 */
export function recipeSuggestion(input = {}) {
  const recipes = Array.isArray(input.recipes) ? input.recipes.filter((item) => item?.definition) : [];
  if (!recipes.length) return { applied: false, requiresConfirmation: true, draft: null, candidates: [] };
  const brief = String(input.brief || '').trim().toLowerCase();
  const scored = recipes
    .map((recipe) => {
      const prompt = String(recipe.definition.prompt || '');
      const hit = brief && prompt.toLowerCase().includes(brief.slice(0, Math.min(6, brief.length))) ? 1 : 0;
      return { recipe, hit };
    })
    .sort((a, b) => b.hit - a.hit);
  const best = scored[0].recipe;
  return {
    applied: false,
    requiresConfirmation: true,
    draft: { prompt: String(best.definition.prompt || ''), ...(Number.isFinite(Number(best.definition.itemCount)) ? { itemCount: Number(best.definition.itemCount) } : {}), ...(best.definition.aspectRatio ? { aspectRatio: String(best.definition.aspectRatio) } : {}) },
    candidates: scored.map((entry) => ({ id: entry.recipe.id, name: entry.recipe.name }))
  };
}