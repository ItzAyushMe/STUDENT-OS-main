// Pure helpers for atomic schedule save — FIX-GEN-ATOMIC
// No react-native, no supabase, no db — fully unit-testable
// FIX-SCOPE D19b: diagnostics builder (pure, zero behavior changes)

function countByMonth(rows, prefix) {
  if (!Array.isArray(rows)) return 0;
  return rows.filter(r => typeof r.date === 'string' && r.date.startsWith(prefix)).length;
}

function minDate(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const dates = rows.map(r => r.date).filter(Boolean).sort();
  return dates[0] || null;
}

function maxDate(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const dates = rows.map(r => r.date).filter(Boolean).sort();
  return dates[dates.length-1] || null;
}

// FIX-VERIFY v2: pure verify helper — returns exact missing ids
export function computeMissingIds(sentIds, returnedRowsOrIds) {
  if (!Array.isArray(sentIds) || !sentIds.length) return [];
  const returned = Array.isArray(returnedRowsOrIds) ? returnedRowsOrIds : [];
  const returnedSet = new Set(
    returned.map((r) => (typeof r === 'string' ? r : r?.id)).filter(Boolean)
  );
  return sentIds.filter((id) => !returnedSet.has(id));
}

// FIX-VERIFY4: pure helper to summarize probe counts — measurement only
export function summarizeVerifyProbes({
  totalAnyBefore = null,
  totalMineBefore = null,
  deletedCount = null,
  finalCountScoped = null,
  finalCountAnyUser = null,
  finalCountAnyStatus = null,
  chunkWindows = [],
  sampleOrphans = [],
} = {}) {
  const preDelete = {
    totalAnyBefore,
    totalMineBefore,
    deletedCount,
    remainingAnyAfterDelete: typeof totalAnyBefore === 'number' && typeof deletedCount === 'number' ? totalAnyBefore - deletedCount : null,
    remainingMineAfterDelete: typeof totalMineBefore === 'number' && typeof deletedCount === 'number' ? totalMineBefore - deletedCount : null,
  };
  const final = {
    finalCountScoped,
    finalCountAnyUser,
    finalCountAnyStatus,
    orphanDelta: typeof finalCountAnyUser === 'number' && typeof finalCountScoped === 'number' ? finalCountAnyUser - finalCountScoped : null,
    statusDelta: typeof finalCountAnyStatus === 'number' && typeof finalCountScoped === 'number' ? finalCountAnyStatus - finalCountScoped : null,
    missingVsScoped: typeof finalCountScoped === 'number' ? finalCountScoped : null,
    sampleOrphansCount: Array.isArray(sampleOrphans) ? sampleOrphans.length : 0,
    chunkWindowsCount: Array.isArray(chunkWindows) ? chunkWindows.length : 0,
    chunkWindowsMissing: Array.isArray(chunkWindows) ? chunkWindows.filter(w => typeof w.count === 'number' && w.count === 0).length : 0,
  };
  const isWrongOwner = final.orphanDelta !== null && final.orphanDelta > 0;
  const isTrulyAbsent = final.orphanDelta === 0 && typeof finalCountScoped === 'number';
  return { preDelete, final, isWrongOwner, isTrulyAbsent, chunkWindows, sampleOrphans };
}

// FIX-VERIFY5: pure helper to pick short windows for repair
export function pickShortWindows(chunkWindows, chunks) {
  if (!Array.isArray(chunkWindows) || !Array.isArray(chunks)) return [];
  return chunkWindows.filter((w) => {
    const sent = chunks[w.index]?.length || 0;
    return typeof w.count === 'number' && w.count < sent;
  });
}

export function buildPlanDiagnostics({
  rows = [],
  coverage = null,
  syllabus = [],
  profile = {},
  settings = {},
  savedCount = 0,
  failedChunks = [],
  chunkSize = 500,
  workerCount = 2,
  reloadedSessions = [],
  deleteDeletedCount = null,
  verifyInfo = null,
  totalAnyBefore = null,
  totalMineBefore = null,
  finalCountAnyUser = null,
  finalCountAnyStatus = null,
  sampleOrphans = null,
  chunkWindows = null,
  repairInfo = null,
  timelineInfo = null,
}) {
  // PLAN: from generated rows BEFORE save
  const planMonths = {
    '2026-10': countByMonth(rows, '2026-10'),
    '2026-11': countByMonth(rows, '2026-11'),
    '2026-12': countByMonth(rows, '2026-12'),
  };
  const PLAN = {
    totalRows: Array.isArray(rows) ? rows.length : 0,
    firstDate: minDate(rows),
    lastDate: maxDate(rows),
    months: planMonths,
    // also total per month for visibility
    byMonth: planMonths,
  };

  // SAVE
  const SAVE = {
    savedCount,
    totalRows: Array.isArray(rows) ? rows.length : 0,
    savedRatio: `${savedCount}/${Array.isArray(rows) ? rows.length : 0}`,
    failedChunks: Array.isArray(failedChunks) ? failedChunks : [],
    chunkSize,
    workerCount,
  };

  // RELOAD: after post-save load()
  const reloadMonths = {
    '2026-10': countByMonth(reloadedSessions, '2026-10'),
    '2026-11': countByMonth(reloadedSessions, '2026-11'),
    '2026-12': countByMonth(reloadedSessions, '2026-12'),
  };
  const RELOAD = {
    sessionsCount: Array.isArray(reloadedSessions) ? reloadedSessions.length : 0,
    months: reloadMonths,
    byMonth: reloadMonths,
    firstDate: minDate(reloadedSessions),
    lastDate: maxDate(reloadedSessions),
  };

  // PROFILE resolved
  const PROFILE = {
    weekdayHours: coverage?.weekdayHours ?? null,
    weekendHours: coverage?.weekendHours ?? null,
    daysOff: profile?.days_off || [],
    lightDay: settings?.lightDay ?? null,
    cutoff: coverage?.baseCutoff || coverage?.classCutoff || null,
    finalCutoff: coverage?.finalCutoff || null,
    perTagInEffect: coverage?.perTagInEffect ?? null,
    priorityOrder: coverage?.priorityOrder || [],
    timeSplit: coverage?.timeSplit || null,
    // also resolved effective hours for visibility
    effectiveWeekdayHours: null,
    effectiveWeekendHours: null,
  };

  // SYLLABUS
  const totalSyllabus = Array.isArray(syllabus) ? syllabus.length : 0;
  const classRows = Array.isArray(syllabus) ? syllabus.filter(r => (r.track || 'class') === 'class') : [];
  const byClassLevel = {};
  for (const r of classRows) {
    const tag = r.class_level ?? r.classLevel ?? r.grade ?? 'untagged';
    const key = String(tag);
    byClassLevel[key] = (byClassLevel[key] || 0) + 1;
  }
  const withDeadline = Array.isArray(syllabus) ? syllabus.filter(r => r.deadline) : [];
  const deadlines = withDeadline.map(r => r.deadline).filter(Boolean).sort();
  const archivedCount = Array.isArray(syllabus) ? syllabus.filter(r => r.archived).length : 0;
  const completedCount = Array.isArray(syllabus) ? syllabus.filter(r => r.status === 'completed' || r.progress_percent === 100).length : 0;
  const progressGt0Count = Array.isArray(syllabus) ? syllabus.filter(r => (r.progress_percent || 0) > 0).length : 0;
  const sampleClassRows = classRows.slice(0,3).map(r => ({
    subject: r.subject,
    chapter: r.chapter,
    status: r.status,
    track: r.track || 'class',
    class_level: r.class_level ?? r.classLevel ?? r.grade ?? null,
    deadline: r.deadline || null,
    estimated_hours: r.estimated_hours ?? r.estimatedHours ?? null,
  }));
  const SYLLABUS = {
    totalRows: totalSyllabus,
    classRows: classRows.length,
    byClassLevel,
    withDeadline: {
      count: withDeadline.length,
      min: deadlines[0] || null,
      max: deadlines[deadlines.length-1] || null,
    },
    archivedCount,
    completedCount,
    progressGt0Count,
    sample: sampleClassRows,
  };

  // QUEUES: items per track at plan start + date class queue empties
  const queuesAtStart = {};
  if (Array.isArray(syllabus)) {
    for (const r of syllabus) {
      const t = r.track || 'class';
      queuesAtStart[t] = (queuesAtStart[t] || 0) + 1;
    }
  }
  // date class queue empties = last date where class study appears in generated rows
  let classQueueEmptiesDate = null;
  if (Array.isArray(rows)) {
    const classStudyDates = rows.filter(r => (r.track || 'class') === 'class' && r.session_type === 'study').map(r => r.date).filter(Boolean).sort();
    if (classStudyDates.length) classQueueEmptiesDate = classStudyDates[classStudyDates.length-1];
  }
  const QUEUES = {
    atStart: queuesAtStart,
    classQueueEmptiesDate,
  };

  const DELETE = {
    deletedCount: deleteDeletedCount,
    totalAnyBefore: totalAnyBefore,
    totalMineBefore: totalMineBefore,
  };

  const VERIFY = verifyInfo || {
    perChunk: [],
    retries: 0,
    finalCount: null,
  };

  // FIX-VERIFY4: emit additional probe counts (measurement only)
  const FINAL_PROBES = {
    finalCountAnyUser,
    finalCountAnyStatus,
    sampleOrphans: Array.isArray(sampleOrphans) ? sampleOrphans : [],
    chunkWindows: Array.isArray(chunkWindows) ? chunkWindows : [],
  };

  const REPAIR = repairInfo || {
    iterations: 0,
    repairedWindows: [],
    finalAfterRepair: null,
  };

  const TIMELINE = timelineInfo || {
    deleteDone: null,
    chunkReceipt: [],
    chunkWindowCount: [],
    repair: [],
    finalCountDone: null,
  };

  return {
    PLAN,
    SAVE,
    RELOAD,
    PROFILE,
    SYLLABUS,
    QUEUES,
    DELETE,
    VERIFY,
    finalCountAnyUser,
    finalCountAnyStatus,
    sampleOrphans: FINAL_PROBES.sampleOrphans,
    chunkWindows: FINAL_PROBES.chunkWindows,
    FINAL_PROBES,
    REPAIR,
    TIMELINE,
    generatedAt: new Date().toISOString(),
  };
}

export function chunkRows(rows, size = 500) {
  if (!Array.isArray(rows)) return [];
  const s = Math.max(1, Number(size) || 500);
  const out = [];
  for (let i = 0; i < rows.length; i += s) {
    out.push(rows.slice(i, i + s));
  }
  return out;
}

export function isRunStale(currentRun, myRun) {
  return currentRun !== myRun;
}

// Worker-pool save: runs insertFn(chunk) with concurrency, reports progress
// insertFn: async (chunk, index) => void
// onProgress: (completed, total) => void
// shouldAbort: () => boolean — if true, stops early
// Returns { savedCount, totalRows, failedIndexes }
export async function saveWithWorkers(chunks, insertFn, onProgress, concurrency = 2, shouldAbort = () => false) {
  const total = chunks.length;
  let completed = 0;
  let savedCount = 0;
  const failedIndexes = [];
  let nextIdx = 0;

  const worker = async () => {
    while (true) {
      if (shouldAbort()) break;
      const cur = nextIdx++;
      if (cur >= total) break;
      const chunk = chunks[cur];
      try {
        await insertFn(chunk, cur);
        savedCount += chunk.length;
      } catch (e) {
        // retry once
        try {
          await insertFn(chunk, cur);
          savedCount += chunk.length;
        } catch (e2) {
          failedIndexes.push(cur);
        }
      }
      completed += 1;
      if (typeof onProgress === 'function') {
        try { onProgress(completed, total); } catch {}
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
  await Promise.all(workers);
  return { savedCount, totalRows: chunks.reduce((a, c) => a + c.length, 0), failedIndexes, completed };
}
