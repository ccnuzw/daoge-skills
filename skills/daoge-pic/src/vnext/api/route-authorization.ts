import { LocalAccessError, LocalAuthentication } from './local-auth';

/**
 * Who is allowed to call a route.
 *
 * `bearer` is the Skill/CLI capability token; `cookie` is the same-origin Workbench session cookie.
 *
 * The default for a route that is absent from `ROUTE_AUTHORIZATION_RULES` is **both** — and that default is
 * deliberate, not an oversight. A Workbench page has to be able to create projects, tasks and rounds, so most
 * write routes are cookie-writable. What earns a route a place in this table is one of two things:
 *
 *   1. It spends money, starts or stops the daemon, or rewrites stored credentials — so the human gate and the
 *      agent that must not bypass it have to be provably different principals (`bearer`).
 *   2. It is the human gate itself — so it must be the one endpoint an agent token can never answer for itself
 *      (`cookie`, currently only `rounds.confirm`).
 *
 * The dividing line is therefore "is there a defence that does not depend on who is calling", not "do we trust
 * the browser". See the comment above `providerSecretAction` in `server.ts` for the concrete reasoning.
 */
export type RouteActor = LocalAuthentication;

export interface RouteAuthorizationRule {
  /** Stable id. Tests and the drift guard refer to rules by this, never by index. */
  id: string;
  /** HTTP methods this rule guards. Anything not listed is unaffected. */
  methods: readonly string[];
  /** Anchored pattern, matched against `pathname` only — never against the query string. */
  pattern: RegExp;
  /** A concrete path the rule must still match. The guard test uses it to catch a dead or drifted regex. */
  sample: string;
  actor: RouteActor;
  /** Why the route is restricted. Delivered verbatim as the 403 message, so keep it caller-readable. */
  message: string;
}

/**
 * `write()` is only entered for POST and PUT, so a rule that had no method guard in the inline code it replaces
 * is written here as both methods rather than as "any" — that keeps the 404-vs-403 answers byte-identical.
 */
const WRITE_METHODS: readonly string[] = ['POST', 'PUT'];

export const ROUTE_AUTHORIZATION_RULES: readonly RouteAuthorizationRule[] = [
  {
    id: 'confirmed-templates.list',
    methods: ['GET'],
    pattern: /^\/api\/confirmed-templates$/,
    sample: '/api/confirmed-templates',
    actor: 'bearer',
    message: 'Confirmed templates require Skill/CLI authentication.'
  },
  {
    id: 'confirmed-templates.detail',
    methods: ['GET'],
    pattern: /^\/api\/confirmed-templates\/[^/]+$/,
    sample: '/api/confirmed-templates/tpl_1',
    actor: 'bearer',
    message: 'Confirmed templates require Skill/CLI authentication.'
  },
  {
    id: 'confirmed-templates.write',
    methods: WRITE_METHODS,
    pattern: /^\/api\/confirmed-templates(?:\/[^/]+\/(?:archive|rollback))?$/,
    sample: '/api/confirmed-templates/tpl_1/archive',
    actor: 'bearer',
    message: 'Confirmed template writes require Skill/CLI authentication.'
  },
  {
    id: 'budget.write',
    methods: ['POST'],
    pattern: /^\/api\/budget$/,
    sample: '/api/budget',
    actor: 'bearer',
    message: 'Budget writes require Skill/CLI authentication.'
  },
  {
    id: 'backup.restore-dry-run',
    methods: ['POST'],
    pattern: /^\/api\/backup\/restore-dry-run$/,
    sample: '/api/backup/restore-dry-run',
    actor: 'bearer',
    message: 'Backup restore dry-run requires Skill/CLI authentication.'
  },
  {
    id: 'backup.restore',
    methods: ['POST'],
    pattern: /^\/api\/backup\/restore$/,
    sample: '/api/backup/restore',
    actor: 'bearer',
    message: 'Backup restore requires Skill/CLI authentication.'
  },
  {
    id: 'backup.upgrade-assess',
    methods: ['POST'],
    pattern: /^\/api\/backup\/upgrade-assess$/,
    sample: '/api/backup/upgrade-assess',
    actor: 'bearer',
    message: 'Backup upgrade assessment requires Skill/CLI authentication.'
  },
  {
    id: 'backup.rollback-point',
    methods: ['POST'],
    pattern: /^\/api\/backup\/rollback-point$/,
    sample: '/api/backup/rollback-point',
    actor: 'bearer',
    message: 'Backup rollback point requires Skill/CLI authentication.'
  },
  {
    id: 'daemon.shutdown',
    methods: ['POST'],
    pattern: /^\/api\/shutdown$/,
    sample: '/api/shutdown',
    actor: 'bearer',
    message: '只有当前 Skill/CLI 可以关闭 Studio daemon。'
  },
  {
    id: 'rounds.confirm',
    methods: WRITE_METHODS,
    pattern: /^\/api\/rounds\/[^/]+\/confirm$/,
    sample: '/api/rounds/rnd_1/confirm',
    actor: 'cookie',
    message: '创作确认必须由已授权 Workbench 中的真实用户完成。'
  },
  {
    id: 'rounds.preflight',
    methods: WRITE_METHODS,
    pattern: /^\/api\/rounds\/[^/]+\/preflight$/,
    sample: '/api/rounds/rnd_1/preflight',
    actor: 'bearer',
    message: '预检必须由当前智能体会话在用户确认后提交。'
  },
  {
    id: 'runs.create',
    methods: WRITE_METHODS,
    pattern: /^\/api\/runs$/,
    sample: '/api/runs',
    actor: 'bearer',
    message: '生成运行必须由当前智能体会话在用户确认后提交。'
  },
  {
    id: 'runs.reconcile',
    methods: ['POST'],
    pattern: /^\/api\/runs\/[^/]+\/items\/[^/]+\/reconcile$/,
    sample: '/api/runs/run_1/items/itm_1/reconcile',
    actor: 'bearer',
    message: '外部请求对账必须由当前 Skill/CLI 显式发起。'
  },
  {
    id: 'runs.pause',
    methods: WRITE_METHODS,
    pattern: /^\/api\/runs\/[^/]+\/pause$/,
    sample: '/api/runs/run_1/pause',
    actor: 'bearer',
    message: '运行控制必须由当前 Skill/CLI 发起。'
  },
  {
    id: 'runs.outcomes-resolve',
    methods: WRITE_METHODS,
    pattern: /^\/api\/runs\/[^/]+\/outcomes\/resolve$/,
    sample: '/api/runs/run_1/outcomes/resolve',
    actor: 'bearer',
    message: '运行控制必须由当前 Skill/CLI 发起。'
  },
  {
    id: 'runs.retry',
    methods: WRITE_METHODS,
    pattern: /^\/api\/runs\/[^/]+\/retry$/,
    sample: '/api/runs/run_1/retry',
    actor: 'bearer',
    message: '运行控制必须由当前 Skill/CLI 发起。'
  },
  {
    id: 'runs.resume',
    methods: WRITE_METHODS,
    pattern: /^\/api\/runs\/[^/]+\/resume$/,
    sample: '/api/runs/run_1/resume',
    actor: 'bearer',
    message: '运行恢复必须由当前 Skill/CLI 在用户重新确认后提交。'
  },
  {
    id: 'runs.cancel',
    methods: WRITE_METHODS,
    pattern: /^\/api\/runs\/[^/]+\/cancel$/,
    sample: '/api/runs/run_1/cancel',
    actor: 'bearer',
    message: '运行控制必须由当前 Skill/CLI 发起。'
  }
];

/** First rule that governs this method + path, or `null` when the route is open to either principal. */
export function findRouteAuthorizationRule(pathname: string, method: string): RouteAuthorizationRule | null {
  for (const rule of ROUTE_AUTHORIZATION_RULES) {
    if (!rule.methods.includes(method)) continue;
    if (!rule.pattern.test(pathname)) continue;
    return rule;
  }
  return null;
}

/**
 * Single gate for every per-route permission check. Call it once, right after the request has been authenticated,
 * so that authorisation is decided before any handler touches the database or the body.
 */
export function assertRouteAuthorization(pathname: string, method: string, authentication: LocalAuthentication): void {
  const rule = findRouteAuthorizationRule(pathname, method);
  if (!rule || rule.actor === authentication) return;
  throw new LocalAccessError(403, 'forbidden', rule.message);
}
