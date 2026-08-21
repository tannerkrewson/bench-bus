import { promises as fs } from "node:fs";
import path from "node:path";
import {
  openRouterModelPricingSchema,
  normalizeSnapshotInput,
  resolveManifestEntryAt,
  snapshotEnvelopeSchema,
  snapshotManifestSchema,
  validateAaModelCollection,
  validateCursorEvalCollection,
  SCHEMA_VERSIONS,
  type ManifestEntry,
  type SnapshotEnvelope,
  type SnapshotManifest,
  type SnapshotSource,
} from "../schemas";
import { manifestPath, snapshotPath } from "./paths";

/** A successfully persisted snapshot, as reported by {@link DataBranchStore.writeSnapshot}. */
export interface StoredSnapshot {
  /** Repo-relative path on the data branch, e.g. snapshots/aa/v1/20260821T015342Z.json */
  path: string;
  entry: ManifestEntry;
  manifest: SnapshotManifest;
}

/** A snapshot resolved for a point in time, re-validated before returning. */
export interface ResolvedSnapshot {
  entry: ManifestEntry;
  envelope: SnapshotEnvelope;
}

/**
 * Validate and deterministically order the record set of one source.
 *
 * This is the validation-before-commit gate: an invalid collection throws
 * here, before anything is written, so it can never overwrite or orphan the
 * latest valid data. AA and Cursor reuse the shared collection validators
 * (which also sort); OpenRouter has no collection-level validator in the
 * schemas module, so per-record validation, duplicate-identity rejection,
 * and sorting happen here.
 */
export function validateRecords(
  source: SnapshotSource,
  records: unknown[],
): SnapshotEnvelope["records"] {
  if (source === "aa") {
    return validateAaModelCollection(records);
  }
  if (source === "cursor") {
    return validateCursorEvalCollection(records);
  }
  if (!Array.isArray(records)) {
    throw new TypeError("OpenRouter pricing collection must be an array");
  }
  const seen = new Map<string, number>();
  const parsed = records.map((record, index) => {
    const result = openRouterModelPricingSchema.safeParse(record);
    if (!result.success) {
      throw new Error(
        `Invalid OpenRouter pricing record at index ${index}: ${result.error.message}`,
      );
    }
    const firstAtIndex = seen.get(result.data.aaModelSlug);
    if (firstAtIndex !== undefined) {
      throw new Error(
        `Duplicate OpenRouter pricing identity "${result.data.aaModelSlug}" at indices ${firstAtIndex} and ${index}`,
      );
    }
    seen.set(result.data.aaModelSlug, index);
    return result.data;
  });
  return parsed.sort((a, b) => a.aaModelSlug.localeCompare(b.aaModelSlug));
}

/** Write `contents` so readers only ever observe a complete file. */
async function atomicWriteFile(file: string, contents: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, contents, "utf8");
  await fs.rename(tmp, file);
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export interface WriteSnapshotOptions {
  /**
   * Reject zero-record snapshots by default: an empty collection usually
   * means an upstream shape change or collector bug, and accepting it would
   * let a broken run shadow the last known-good data at later timestamps.
   */
  allowEmpty?: boolean;
}

/**
 * Filesystem-backed store for the machine-generated history that lives on
 * the `bench-bus-data` branch. All paths are interpreted relative to
 * `rootDir`, which is the checked-out working tree of the data branch (or a
 * test fixture directory shaped like one).
 *
 * Invariants:
 * - Snapshot files are immutable: an existing snapshot path is never
 *   rewritten (writes fail closed instead).
 * - The manifest is the only index consulted for resolution, so a snapshot
 *   file that was written but whose manifest update failed is ignored
 *   (treated as an orphan) rather than served as valid history.
 * - Every snapshot is fully re-validated on write AND on read.
 */
export class DataBranchStore {
  constructor(readonly rootDir: string) {}

  private abs(repoRelativePath: string): string {
    if (path.isAbsolute(repoRelativePath)) {
      throw new TypeError("paths must be relative to the data-branch root");
    }
    return path.join(this.rootDir, repoRelativePath);
  }

  /**
   * First-run initialization: create the expected directory skeleton. Safe
   * to run repeatedly and on an already-populated data branch.
   */
  async init(): Promise<void> {
    await fs.mkdir(this.abs("snapshots"), { recursive: true });
    await fs.mkdir(this.abs("manifests"), { recursive: true });
  }

  /** Read and validate a source's manifest; undefined when none exists yet. */
  async readManifest(source: SnapshotSource): Promise<SnapshotManifest | undefined> {
    const file = this.abs(manifestPath(source));
    if (!(await fileExists(file))) {
      return undefined;
    }
    const raw = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    return snapshotManifestSchema.parse(raw);
  }

  /**
   * Persist a fully validated snapshot envelope and update the manifest.
   *
   * Order of operations guarantees last-known-good safety:
   * 1. validate envelope + records (throws before any write),
   * 2. refuse to overwrite an existing snapshot path or duplicate manifest
   *    entry,
   * 3. write the snapshot file atomically,
   * 4. append the manifest entry and move `latestKnownGood` (atomic).
   *
   * If step 4 fails after step 3, the snapshot file remains on disk but is
   * not referenced by the manifest; resolution ignores it (see
   * {@link listOrphans}) and the previous valid history is untouched.
   */
  async writeSnapshot(
    envelope: unknown,
    options: WriteSnapshotOptions = {},
  ): Promise<StoredSnapshot> {
    const parsedEnvelope = snapshotEnvelopeSchema.parse(normalizeSnapshotInput(envelope));
    const records = validateRecords(parsedEnvelope.source, parsedEnvelope.records);
    if (records.length === 0 && !options.allowEmpty) {
      throw new Error(
        `Refusing to persist an empty ${parsedEnvelope.source} snapshot at ${parsedEnvelope.observedAt}; pass allowEmpty to override`,
      );
    }
    const validated: SnapshotEnvelope = { ...parsedEnvelope, records };

    const relPath = snapshotPath(
      validated.source,
      validated.recordSchemaVersion,
      validated.observedAt,
    );
    const absPath = this.abs(relPath);
    if (await fileExists(absPath)) {
      throw new Error(`Refusing to overwrite existing snapshot file: ${relPath}`);
    }

    const manifest = await this.readManifest(validated.source);
    if (manifest?.entries.some((e) => e.observedAt === validated.observedAt)) {
      throw new Error(
        `Manifest already contains a ${validated.source} entry at ${validated.observedAt}`,
      );
    }

    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await atomicWriteFile(absPath, `${JSON.stringify(validated, null, 2)}\n`);

    const entry: ManifestEntry = {
      observedAt: validated.observedAt,
      path: relPath,
      schemaVersion: validated.recordSchemaVersion,
    };
    const nextManifest: SnapshotManifest = manifest
      ? { ...manifest, entries: [...manifest.entries, entry], latestKnownGood: validated.observedAt }
      : {
          schemaVersion: SCHEMA_VERSIONS.manifest,
          source: validated.source,
          entries: [entry],
          latestKnownGood: validated.observedAt,
        };
    // Self-check before persisting the index.
    snapshotManifestSchema.parse(nextManifest);
    await atomicWriteFile(
      this.abs(manifestPath(validated.source)),
      `${JSON.stringify(nextManifest, null, 2)}\n`,
    );

    return { path: relPath, entry, manifest: nextManifest };
  }

  /**
   * Resolve the newest valid snapshot for `source` at or before `asOf`
   * (independent per-source point-in-time selection). Re-validates the file
   * before returning, so a corrupted or tampered snapshot fails closed
   * instead of feeding bad data to derived builds. Returns undefined when
   * the requested time precedes all collected history for the source.
   */
  async resolveSnapshot(source: SnapshotSource, asOf: string): Promise<ResolvedSnapshot | undefined> {
    const manifest = await this.readManifest(source);
    if (!manifest) {
      return undefined;
    }
    const entry = resolveManifestEntryAt(manifest, asOf);
    if (!entry) {
      return undefined;
    }
    const raw = JSON.parse(await fs.readFile(this.abs(entry.path), "utf8")) as unknown;
    const parsedEnvelope = snapshotEnvelopeSchema.parse(raw);
    const records = validateRecords(parsedEnvelope.source, parsedEnvelope.records);
    return { entry, envelope: { ...parsedEnvelope, records } };
  }

  /** The manifest's newest fully valid snapshot for `source`, if any. */
  async latestKnownGood(source: SnapshotSource): Promise<ManifestEntry | undefined> {
    const manifest = await this.readManifest(source);
    return manifest?.entries.find((e) => e.observedAt === manifest.latestKnownGood);
  }

  /**
   * Snapshot files present on disk but not referenced by the manifest (e.g.
   * a manifest update that failed mid-write). Orphans are never served by
   * resolution; list them so an operator can inspect or clean them up.
   */
  async listOrphans(source: SnapshotSource): Promise<string[]> {
    const manifest = await this.readManifest(source);
    const referenced = new Set(manifest?.entries.map((e) => e.path) ?? []);
    const orphans: string[] = [];
    const sourceDir = this.abs(`snapshots/${source}`);
    await walkJsonFiles(sourceDir, (fullPath) => {
      const relPath = path.relative(this.rootDir, fullPath).split(path.sep).join("/");
      if (!referenced.has(relPath)) {
        orphans.push(relPath);
      }
    });
    return orphans.sort();
  }

  /**
   * Retention/compaction hook: normalize a manifest (sort by observedAt,
   * drop exact-duplicate entries). NEVER deletes or rewrites snapshot files;
   * source snapshots are preserved by default and permanently. The only
   * manifest rewrite allowed here is one that keeps `latestKnownGood`
   * pointing at an existing entry.
   */
  async compactManifest(source: SnapshotSource): Promise<SnapshotManifest> {
    const manifest = await this.readManifest(source);
    if (!manifest) {
      throw new Error(`No manifest for source "${source}" to compact`);
    }
    const byObservedAt = new Map(manifest.entries.map((e) => [e.observedAt, e]));
    const entries = [...byObservedAt.values()].sort((a, b) =>
      a.observedAt.localeCompare(b.observedAt),
    );
    const compacted: SnapshotManifest = { ...manifest, entries };
    snapshotManifestSchema.parse(compacted);
    await atomicWriteFile(
      this.abs(manifestPath(source)),
      `${JSON.stringify(compacted, null, 2)}\n`,
    );
    return compacted;
  }
}

async function walkJsonFiles(dir: string, visit: (repoRelativeFile: string) => Promise<void> | void): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkJsonFiles(full, visit);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      await visit(full);
    }
  }
}
