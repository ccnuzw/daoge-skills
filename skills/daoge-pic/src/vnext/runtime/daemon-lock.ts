import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { createId, nowIso } from '../shared/ids';
import { enforceSensitiveAccess } from '../studio/workspace';

const SQLITE_BUSY = 5;
const LOCK_BUSY_TIMEOUT_MS = 100;

export interface DaemonLockRecord {
  pid: number;
  ownerId: string;
  acquiredAt: string;
}

export interface DaemonLockPaths {
  databasePath: string;
  ownerRecordPath: string;
}

export interface DaemonLockHandle {
  readonly databasePath: string;
  readonly ownerRecordPath: string;
  readonly ownerId: string;
  readonly pid: number;
  release(): boolean;
}

type LockDatabase = DatabaseSyncType;
type DatabaseSyncConstructor = new (databasePath: string) => LockDatabase;

export interface DaemonLockDependencies {
  databaseConstructor?: DatabaseSyncConstructor;
}

function databaseConstructor(): DatabaseSyncConstructor {
  return require('node:sqlite').DatabaseSync as DatabaseSyncConstructor;
}

function errno(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String(error.code) : undefined;
}

function sqlitePrimaryResultCode(error: unknown): number | null {
  if (!(error instanceof Error) || !('errcode' in error)) return null;
  const resultCode = Number(error.errcode);
  return Number.isInteger(resultCode) ? resultCode & 0xff : null;
}

function isSqliteBusy(error: unknown): boolean {
  return errno(error) === 'ERR_SQLITE_ERROR' && sqlitePrimaryResultCode(error) === SQLITE_BUSY;
}

function assertCoordinationDatabasePath(databasePath: string): void {
  try {
    const stat = fs.lstatSync(databasePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Studio daemon coordination database must be a regular file inside the private runtime directory.');
  } catch (error) {
    if (errno(error) !== 'ENOENT') throw error;
  }
}

function configureCoordinationDatabase(database: LockDatabase): void {
  database.exec('PRAGMA busy_timeout = ' + LOCK_BUSY_TIMEOUT_MS + ';');
  const journal = database.prepare('PRAGMA journal_mode = DELETE').get() as { journal_mode?: unknown } | undefined;
  if (String(journal?.journal_mode || '').toLowerCase() !== 'delete') throw new Error('Studio daemon coordination database requires SQLite DELETE journal mode.');
  database.exec('PRAGMA synchronous = FULL;');
}

function writeOwnerRecordAtomically(ownerRecordPath: string, record: DaemonLockRecord): void {
  const temporaryPath = path.join(path.dirname(ownerRecordPath), '.' + path.basename(ownerRecordPath) + '.tmp-' + record.ownerId);
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(record) + '\n', 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporaryPath, ownerRecordPath);
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* preserve the original failure */ }
    }
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* preserve the original failure */ }
    throw error;
  }
}

function parseOwnerRecord(ownerRecordPath: string): DaemonLockRecord | null {
  try {
    const stat = fs.lstatSync(ownerRecordPath);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;
    const value = JSON.parse(fs.readFileSync(ownerRecordPath, 'utf8')) as { pid?: unknown; ownerId?: unknown; acquiredAt?: unknown };
    return Number.isInteger(value.pid) && Number(value.pid) > 0
      && typeof value.ownerId === 'string' && value.ownerId
      && typeof value.acquiredAt === 'string' && value.acquiredAt
      ? { pid: Number(value.pid), ownerId: value.ownerId, acquiredAt: value.acquiredAt }
      : null;
  } catch (error) {
    if (errno(error) === 'ENOENT') return null;
    return null;
  }
}

function removeOwnedRecord(ownerRecordPath: string, ownerId: string, pid: number): boolean {
  const record = parseOwnerRecord(ownerRecordPath);
  if (!record || record.pid !== pid || record.ownerId !== ownerId) return false;
  fs.unlinkSync(ownerRecordPath);
  return true;
}

function releaseLockDatabase(database: LockDatabase): void {
  let failure: unknown = null;
  try { database.exec('ROLLBACK'); } catch (error) { failure = error; }
  try { database.close(); } catch (error) { if (!failure) failure = error; }
  if (failure) throw failure;
}

export function acquireDaemonLock(paths: DaemonLockPaths, dependencies: DaemonLockDependencies = {}): DaemonLockHandle {
  assertCoordinationDatabasePath(paths.databasePath);
  const DatabaseSync = dependencies.databaseConstructor || databaseConstructor();
  const database = new DatabaseSync(paths.databasePath);
  let transactionHeld = false;
  try {
    assertCoordinationDatabasePath(paths.databasePath);
    enforceSensitiveAccess(paths.databasePath, false);
    configureCoordinationDatabase(database);
    database.exec('BEGIN EXCLUSIVE');
    transactionHeld = true;

    const pid = process.pid;
    const ownerId = createId('daemon-lock');
    const record: DaemonLockRecord = { pid, ownerId, acquiredAt: nowIso() };
    writeOwnerRecordAtomically(paths.ownerRecordPath, record);

    let released = false;
    return {
      databasePath: paths.databasePath,
      ownerRecordPath: paths.ownerRecordPath,
      ownerId,
      pid,
      release(): boolean {
        if (released) return false;
        released = true;
        let removed = false;
        let failure: unknown = null;
        try { removed = removeOwnedRecord(paths.ownerRecordPath, ownerId, pid); } catch (error) { failure = error; }
        try { releaseLockDatabase(database); } catch (error) { if (!failure) failure = error; }
        if (failure) throw failure;
        return removed;
      }
    };
  } catch (error) {
    try {
      if (transactionHeld) database.exec('ROLLBACK');
    } catch { /* closing the connection still releases every SQLite lock */ }
    try { database.close(); } catch { /* preserve the acquisition failure */ }
    if (isSqliteBusy(error)) throw new Error('Studio daemon is already running for this workspace.');
    throw error;
  }
}
