import type { TopologyChangeItem } from "@steed/api/shared";

export class InvalidTopologySince extends Error {
  constructor() { super("invalid_since"); }
}

export class TopologyResyncRequired extends Error {
  constructor(public readonly currentRevision: number, public readonly oldestRetainedRevision: number) {
    super("resync_required");
  }
}

export function parseTopologySince(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^\d+$/.test(value)) throw new InvalidTopologySince();
  const revision = Number(value);
  if (!Number.isSafeInteger(revision)) throw new InvalidTopologySince();
  return revision;
}

export function requireRetainedTopologySince(since: number, currentRevision: number, oldest: number | null): number {
  const oldestRetainedRevision = oldest ?? currentRevision;
  if (since > currentRevision || since < oldestRetainedRevision) {
    throw new TopologyResyncRequired(currentRevision, oldestRetainedRevision);
  }
  return oldestRetainedRevision;
}

interface ChangeRow {
  id: number; revision: number; requestId: string; actor: string; tokenId: string | null;
  provenance: string | null; kind: "operations" | "replace" | "revert";
  revertsChangeId: number | null; summary: string; createdAt: number;
}
interface RevisionRow { revision: number }
interface OldestRow { oldest: number | null }
interface ItemRow { seq: number; collection: TopologyChangeItem["collection"]; id: string }
interface ImageRow { seq: number; side: "before" | "after"; image: string }

const changeColumns = `id, revision, request_id AS requestId, actor, token_id AS tokenId, provenance,
  kind, reverts_change_id AS revertsChangeId, summary, created_at AS createdAt`;
const summary = (row: ChangeRow) => ({ ...row, summary: JSON.parse(row.summary) as unknown });
export type TopologyChangeSummary = ReturnType<typeof summary>;

function rows<T>(result: D1Result<T> | undefined): T[] {
  if (!result?.success) throw new Error("Topology history read failed.");
  return result.results;
}

export async function listTopologyChanges(db: D1Database, options: { since?: number; cursor?: number; limit: number }) {
  const { since, cursor, limit } = options;
  const result = await db.batch<RevisionRow | OldestRow | ChangeRow>([
    db.prepare("SELECT revision FROM topology_meta WHERE id = 'main'"),
    db.prepare("SELECT MIN(revision) AS oldest FROM topo_changes"),
    db.prepare(`SELECT ${changeColumns} FROM topo_changes
      WHERE (? IS NULL OR revision > ?) AND (? IS NULL OR id < ?)
      ORDER BY id DESC LIMIT ?`).bind(since ?? null, since ?? null, cursor ?? null, cursor ?? null, limit + 1),
  ]);
  const meta = rows(result[0] as D1Result<RevisionRow> | undefined)[0];
  const oldest = rows(result[1] as D1Result<OldestRow> | undefined)[0];
  if (!meta || !oldest) throw new Error("Topology history metadata is missing.");
  const oldestRetainedRevision = oldest.oldest ?? meta.revision;
  if (since !== undefined) requireRetainedTopologySince(since, meta.revision, oldest.oldest);
  const changes = rows(result[2] as D1Result<ChangeRow> | undefined);
  const data = changes.slice(0, limit).map(summary);
  return {
    currentRevision: meta.revision,
    oldestRetainedRevision,
    data,
    nextCursor: changes.length > limit ? data.at(-1)?.id ?? null : null,
  };
}

export async function getTopologyChangeWithRevision(db: D1Database, id: number) {
  const result = await db.batch<ChangeRow | ItemRow | ImageRow | RevisionRow>([
    db.prepare(`SELECT ${changeColumns} FROM topo_changes WHERE id = ?`).bind(id),
    db.prepare("SELECT seq, collection, entity_id AS id FROM topo_change_items WHERE change_id = ? ORDER BY seq").bind(id),
    db.prepare("SELECT seq, side, image_json AS image FROM topo_change_images WHERE change_id = ? ORDER BY seq, side").bind(id),
    db.prepare("SELECT revision FROM topology_meta WHERE id = 'main'"),
  ]);
  const change = rows(result[0] as D1Result<ChangeRow> | undefined)[0];
  const items = rows(result[1] as D1Result<ItemRow> | undefined);
  const images = rows(result[2] as D1Result<ImageRow> | undefined);
  const metadata = rows(result[3] as D1Result<RevisionRow> | undefined)[0];
  if (!metadata) throw new Error("Topology history metadata is missing.");
  if (!change) return null;
  const bySequence = new Map<number, { before: unknown; after: unknown }>();
  for (const image of images) {
    const pair = bySequence.get(image.seq) ?? { before: null, after: null };
    pair[image.side] = JSON.parse(image.image) as unknown;
    bySequence.set(image.seq, pair);
  }
  const changes = items.map((item) => {
    const pair = bySequence.get(item.seq);
    if (!pair || (pair.before === null && pair.after === null)) throw new Error("Topology change image is missing.");
    return { collection: item.collection, id: item.id, ...pair } as TopologyChangeItem;
  });
  return { change: { ...summary(change), items: changes }, revision: metadata.revision };
}

export async function getTopologyChange(db: D1Database, id: number) {
  return (await getTopologyChangeWithRevision(db, id))?.change ?? null;
}

export async function laterTopologyChangeIdentities(db: D1Database, revision: number) {
  const result = await db.prepare(`SELECT DISTINCT i.collection, i.entity_id AS id
    FROM topo_change_items i JOIN topo_changes c ON c.id = i.change_id
    WHERE c.revision > ? ORDER BY i.collection, i.entity_id`).bind(revision).all<Pick<TopologyChangeItem, "collection" | "id">>();
  return rows(result);
}

export function pruneTopologyHistoryStatement(db: D1Database, now: number) {
  return db.prepare(`WITH RECURSIVE retained(revision) AS (
    SELECT COALESCE(MIN(revision), 0) FROM topo_changes
    WHERE created_at >= ? OR revision >= COALESCE((SELECT revision FROM topo_changes ORDER BY revision DESC LIMIT 1 OFFSET 499), 0)
    UNION
    SELECT parent.revision FROM retained r
    JOIN topo_changes child ON child.revision >= r.revision
    JOIN topo_changes parent ON parent.id = child.reverts_change_id
    WHERE parent.revision < r.revision
  )
  DELETE FROM topo_changes WHERE revision < COALESCE((SELECT MIN(revision) FROM retained), 0)`)
    .bind(now - 90 * 86400);
}
