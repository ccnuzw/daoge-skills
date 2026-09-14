import fs from 'node:fs';
import path from 'node:path';
import { createLocalCapability } from '../api/local-auth';
import type { ConfirmationGatePersistence, ConfirmationGateState } from '../api/confirmation-gate';
import type { WorkbenchPresencePersistence, WorkbenchPresenceState } from './workbench-presence';

/**
 * State that must survive a daemon process restart.
 *
 * A daemon restart used to rotate the capability and session token and drop every pending confirmation, which
 * meant every open Workbench tab started returning 401 and the operator had to redo the confirm dance. All three
 * pieces below are authorization state for this workspace, so they live in the already 0700 runtime directory as
 * 0600 JSON rather than in the business database -- a backup or copy of studio.db therefore never carries live
 * tokens. Delete `daemon-identity.json` to rotate credentials deliberately.
 */

export const DAEMON_IDENTITY_FILE = 'daemon-identity.json';
const CONFIRMATION_GATE_FILE = 'confirmation-gate.json';
const WORKBENCH_PRESENCE_FILE = 'workbench-presence.json';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,}$/;

export interface DaemonIdentity {
  version: 1;
  capability: string;
  sessionToken: string;
  gateSecret: string;
}

function atomicWriteJson(file: string, value: unknown): void {
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temporary, file);
  try { fs.chmodSync(file, 0o600); } catch { /* platforms without chmod keep the umask-derived mode */ }
}

function readJson(file: string): unknown {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function validToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

/** Reuses the recorded identity when it is intact and mints only the tokens that are missing or malformed. */
export function loadOrCreateDaemonIdentity(runtimeDir: string): DaemonIdentity {
  const file = path.join(runtimeDir, DAEMON_IDENTITY_FILE);
  const existing = readJson(file) as Partial<DaemonIdentity> | null;
  const identity: DaemonIdentity = {
    version: 1,
    capability: validToken(existing?.capability) ? existing.capability : createLocalCapability(),
    sessionToken: validToken(existing?.sessionToken) ? existing.sessionToken : createLocalCapability(),
    gateSecret: validToken(existing?.gateSecret) ? existing.gateSecret : createLocalCapability()
  };
  if (!existing || existing.capability !== identity.capability || existing.sessionToken !== identity.sessionToken || existing.gateSecret !== identity.gateSecret) {
    atomicWriteJson(file, identity);
  }
  return identity;
}

/** File-backed confirmation gate state, so a restart does not discard a challenge the operator already answered. */
export function createConfirmationGatePersistence(runtimeDir: string): ConfirmationGatePersistence {
  const file = path.join(runtimeDir, CONFIRMATION_GATE_FILE);
  return {
    load(): ConfirmationGateState | null {
      const value = readJson(file) as Partial<ConfirmationGateState> | null;
      if (!value) return null;
      return {
        challenges: Array.isArray(value.challenges) ? value.challenges : [],
        consents: Array.isArray(value.consents) ? value.consents : [],
        issuedTokens: Array.isArray(value.issuedTokens) ? value.issuedTokens : []
      };
    },
    save(state: ConfirmationGateState): void {
      atomicWriteJson(file, state);
    }
  };
}

/** File-backed Workbench presence, so a restart does not make the next `open` believe no Workbench exists. */
export function createWorkbenchPresencePersistence(runtimeDir: string): WorkbenchPresencePersistence {
  const file = path.join(runtimeDir, WORKBENCH_PRESENCE_FILE);
  return {
    load(): WorkbenchPresenceState | null {
      const value = readJson(file) as Partial<WorkbenchPresenceState> | null;
      if (!value) return null;
      return {
        claimDigestHex: typeof value.claimDigestHex === 'string' ? value.claimDigestHex : null,
        claimExpiresAt: Number.isFinite(Number(value.claimExpiresAt)) ? Number(value.claimExpiresAt) : 0,
        lastAuthenticatedAt: Number.isFinite(Number(value.lastAuthenticatedAt)) ? Number(value.lastAuthenticatedAt) : 0
      };
    },
    save(state: WorkbenchPresenceState): void {
      atomicWriteJson(file, state);
    }
  };
}
