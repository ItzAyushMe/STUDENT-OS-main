// ============================================================
// StudentOS — FIX-S S5: preset -> syllabus rows, and the ONE dedupe rule.
//
// This module is deliberately DB-FREE (no ./db, no AsyncStorage, no react-native)
// so the exact code that builds and filters an import can be unit-tested in Node
// by scripts/logic-test.mjs. src/lib/starterData.js keeps the effectful half
// (db.insertMany) and delegates everything else here — one rule, two callers:
// the Syllabus screen's preset import and the S5 promotion accept path.
//
// THE RULE: rows are deduped by `subject::chapter` WITHIN a track, and ARCHIVED
// rows never count as duplicates. An archived Class 10 "Science::Life Processes"
// is superseded history; it must not swallow the Class 11 chapter of the same
// name that the promotion imports right after archiving it.
// ============================================================
import { nowIso } from './utils';
import { isArchivedRow } from '../config/constants';

/** The dedupe identity of a syllabus row inside its track. */
export function rowKey(row) {
  return `${row && row.subject}::${row && row.chapter}`;
}

/** Keys of the rows that may block an import — archived rows are excluded. */
export function blockingKeys(existingRows) {
  return new Set(
    (Array.isArray(existingRows) ? existingRows : [])
      .filter((r) => r && !isArchivedRow(r))
      .map(rowKey)
  );
}

/**
 * Preset -> insertable syllabus rows. Field-for-field the mapping the app has
 * always used (starterData.presetToRows), with an injectable timestamp so tests
 * are reproducible.
 */
export function buildPresetRows(userId, preset, track, stamp = nowIso()) {
  if (!preset || !Array.isArray(preset.rows)) return [];
  return preset.rows.map((r) => ({
    user_id: userId,
    subject: r.subject,
    chapter: r.chapter,
    topic: null,
    subtopic: null,
    track,
    weightage: r.weightage || 3,
    estimated_hours: r.estimated_hours || 6,
    status: 'locked',
    progress_percent: 0,
    deadline: null,
    completed_at: null,
    created_at: stamp,
    // FIX-SESSION D14: carry class_level tag if source provides it
    ...(r.class_level != null || r.classLevel != null || r.grade != null ? { class_level: r.class_level ?? r.classLevel ?? r.grade } : {}),
  }));
}

/**
 * The rows an import would actually insert, plus what it would skip.
 * Pure: no db, no clock (unless stamp is omitted).
 * @returns {{all:Array, fresh:Array, skipped:number, blockedByArchived:number}}
 */
export function selectFreshPresetRows(userId, preset, track, existingRows, opts = {}) {
  const all = buildPresetRows(userId, preset, track, opts.stamp);
  const keys = blockingKeys(existingRows);
  const fresh = all.filter((r) => !keys.has(rowKey(r)));
  const archivedNames = new Set(
    (Array.isArray(existingRows) ? existingRows : []).filter((r) => r && isArchivedRow(r)).map(rowKey)
  );
  return {
    all,
    fresh,
    skipped: all.length - fresh.length,
    // how many fresh rows share a name with an ARCHIVED row — proof the archived
    // map did not suppress the new import
    blockedByArchived: fresh.filter((r) => archivedNames.has(rowKey(r))).length,
  };
}
