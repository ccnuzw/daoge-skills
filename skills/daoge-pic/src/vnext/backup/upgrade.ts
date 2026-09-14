import { BackupManifest, backupManifestChecksum } from '../backup/manifest';
import { isVersionInRange, RUNTIME_COMPATIBILITY_RANGE, SUPPORTED_PROTOCOL_RANGE } from '../shared/protocol';

export const UPGRADE_POLICY_VERSION = 1 as const;
export const ROLLBACK_POINT_VERSION = 1 as const;

export type UpgradeIssueCode =
  | 'invalid_version'
  | 'schema_downgrade'
  | 'schema_unsupported'
  | 'protocol_incompatible'
  | 'rollback_missing'
  | 'rollback_mismatch';

export interface UpgradeRollbackPoint {
  version: typeof ROLLBACK_POINT_VERSION;
  runtimeVersion: string;
  schemaVersion: number;
  manifestChecksum: string;
  createdAt: string;
}

export interface UpgradeCompatibilityInput {
  currentRuntimeVersion: string;
  targetRuntimeVersion: string;
  currentSchemaVersion: number;
  targetSchemaVersion: number;
  supportedSchemaVersion: number;
  targetProtocolVersion: string;
  supportedProtocolRange?: string;
  rollbackPoint?: UpgradeRollbackPoint | null;
}

export interface UpgradeAssessment {
  policyVersion: typeof UPGRADE_POLICY_VERSION;
  allowed: boolean;
  requiresRollbackPoint: boolean;
  rollbackReady: boolean;
  issues: Array<{ code: UpgradeIssueCode }>;
}

export interface RollbackPointInput {
  manifest: BackupManifest;
  runtimeVersion: string;
  schemaVersion: number;
  createdAt?: string;
}

function validVersion(value: unknown): value is string {
  return typeof value === 'string' && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:[-+][A-Za-z0-9.-]+)?$/.test(value.trim());
}

function validNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function versionCore(value: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
}

function compareVersions(left: string, right: string): number {
  const a = versionCore(left);
  const b = versionCore(right);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function safeTimestamp(value: unknown): string {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return new Date().toISOString();
}

/** Creates a path-free rollback checkpoint from a validated backup manifest. */
export function buildUpgradeRollbackPoint(input: RollbackPointInput): UpgradeRollbackPoint {
  if (!validVersion(input.runtimeVersion) || !validNonNegativeInteger(input.schemaVersion)) throw new Error('Upgrade rollback point identity is invalid.');
  return {
    version: ROLLBACK_POINT_VERSION,
    runtimeVersion: input.runtimeVersion.trim(),
    schemaVersion: input.schemaVersion,
    manifestChecksum: backupManifestChecksum(input.manifest),
    createdAt: safeTimestamp(input.createdAt)
  };
}

export function validateUpgradeRollbackPoint(point: unknown): point is UpgradeRollbackPoint {
  if (!point || typeof point !== 'object' || Array.isArray(point)) return false;
  if (!('version' in point) || !('runtimeVersion' in point) || !('schemaVersion' in point) || !('manifestChecksum' in point) || !('createdAt' in point)) return false;
  return point.version === ROLLBACK_POINT_VERSION
    && validVersion(point.runtimeVersion)
    && validNonNegativeInteger(point.schemaVersion)
    && typeof point.manifestChecksum === 'string'
    && /^[a-f0-9]{64}$/.test(point.manifestChecksum)
    && typeof point.createdAt === 'string'
    && !Number.isNaN(Date.parse(point.createdAt));
}

/**
 * A schema change is never allowed without a rollback point. A future
 * schema/protocol or a runtime outside this package's compatibility range is
 * rejected before any upgrade side effect can be attempted.
 */
export function evaluateUpgradeCompatibility(input: UpgradeCompatibilityInput): UpgradeAssessment {
  const issues: Array<{ code: UpgradeIssueCode }> = [];
  const versionsValid = validVersion(input.currentRuntimeVersion)
    && validVersion(input.targetRuntimeVersion)
    && validVersion(input.targetProtocolVersion)
    && validNonNegativeInteger(input.currentSchemaVersion)
    && validNonNegativeInteger(input.targetSchemaVersion)
    && validNonNegativeInteger(input.supportedSchemaVersion);
  if (!versionsValid) issues.push({ code: 'invalid_version' });

  const schemaChanges = versionsValid && input.targetSchemaVersion !== input.currentSchemaVersion;
  if (versionsValid && input.targetSchemaVersion < input.currentSchemaVersion) issues.push({ code: 'schema_downgrade' });
  if (versionsValid && input.targetSchemaVersion > input.supportedSchemaVersion) issues.push({ code: 'schema_unsupported' });
  const protocolRange = input.supportedProtocolRange || SUPPORTED_PROTOCOL_RANGE;
  if (versionsValid && !isVersionInRange(input.targetProtocolVersion, protocolRange)) issues.push({ code: 'protocol_incompatible' });
  if (versionsValid
    && compareVersions(input.targetRuntimeVersion, input.currentRuntimeVersion) !== 0
    && !isVersionInRange(input.targetRuntimeVersion, RUNTIME_COMPATIBILITY_RANGE)) issues.push({ code: 'invalid_version' });

  const requiresRollbackPoint = schemaChanges || (versionsValid && compareVersions(input.currentRuntimeVersion, input.targetRuntimeVersion) !== 0);
  const rollbackReady = validateUpgradeRollbackPoint(input.rollbackPoint)
    && input.rollbackPoint.schemaVersion === input.currentSchemaVersion
    && input.rollbackPoint.runtimeVersion === input.currentRuntimeVersion;
  if (requiresRollbackPoint && !rollbackReady) issues.push({ code: input.rollbackPoint ? 'rollback_mismatch' : 'rollback_missing' });

  return {
    policyVersion: UPGRADE_POLICY_VERSION,
    allowed: issues.length === 0,
    requiresRollbackPoint,
    rollbackReady,
    issues
  };
}

export const assessUpgrade = evaluateUpgradeCompatibility;
export const createRollbackPoint = buildUpgradeRollbackPoint;
