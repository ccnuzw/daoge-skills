export const SKILL_PROTOCOL_NAME = 'daoge-pic-skill-protocol';
export const SKILL_PROTOCOL_VERSION = '3.1.0';
export const RUNTIME_VERSION = '6.2.0';
export const SUPPORTED_PROTOCOL_RANGE = '>=3.0.0 <4.0.0';
export const RUNTIME_COMPATIBILITY_RANGE = '>=6.0.0 <7.0.0';

interface SemanticVersion { major: number; minor: number; patch: number; }

function parseSemanticVersion(value: string): SemanticVersion | null {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function compareSemanticVersions(left: SemanticVersion, right: SemanticVersion): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

export function isVersionInRange(version: string, rangeValue: string): boolean {
  const parsed = parseSemanticVersion(version);
  const range = /^>=(\d+\.\d+\.\d+)\s+<(\d+\.\d+\.\d+)$/.exec(rangeValue.trim());
  const lower = range ? parseSemanticVersion(range[1]) : null;
  const upper = range ? parseSemanticVersion(range[2]) : null;
  return Boolean(parsed && lower && upper && compareSemanticVersions(parsed, lower) >= 0 && compareSemanticVersions(parsed, upper) < 0);
}

/** Returns whether a client protocol version is inside this daemon's published range. */
export function isSupportedProtocolVersion(version: string): boolean { return isVersionInRange(version, SUPPORTED_PROTOCOL_RANGE); }

/** Returns whether a daemon runtime version is safe for this Skill package. */
export function isSupportedRuntimeVersion(version: string): boolean { return isVersionInRange(version, RUNTIME_COMPATIBILITY_RANGE); }

export function protocolStatus(): { name: string; version: string; runtimeVersion: string; supportedRange: string } {
  return { name: SKILL_PROTOCOL_NAME, version: SKILL_PROTOCOL_VERSION, runtimeVersion: RUNTIME_VERSION, supportedRange: SUPPORTED_PROTOCOL_RANGE };
}
