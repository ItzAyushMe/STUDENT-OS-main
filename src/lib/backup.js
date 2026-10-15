// FIX-PLANB backup — pure helper, zero behavior change, no db
// Gathers profile + syllabus + schedule + habits + workout logs as JSON
// Used by SettingsScreen Export my data → expo-file-system + expo-sharing

export function gatherBackupData({
  profile = null,
  syllabus = [],
  schedule = [],
  habits = [],
  habit_logs = [],
  workout_logs = [],
  xp_events = [],
  focus_sessions = [],
  content = [],
  flashcards = [],
  mood_logs = [],
  deadlines = [],
} = {}) {
  const now = new Date().toISOString();
  return {
    version: 1,
    exportedAt: now,
    profile: profile || null,
    collections: {
      syllabus: Array.isArray(syllabus) ? syllabus : [],
      schedule: Array.isArray(schedule) ? schedule : [],
      habits: Array.isArray(habits) ? habits : [],
      habit_logs: Array.isArray(habit_logs) ? habit_logs : [],
      workout_logs: Array.isArray(workout_logs) ? workout_logs : [],
      xp_events: Array.isArray(xp_events) ? xp_events : [],
      focus_sessions: Array.isArray(focus_sessions) ? focus_sessions : [],
      content: Array.isArray(content) ? content : [],
      flashcards: Array.isArray(flashcards) ? flashcards : [],
      mood_logs: Array.isArray(mood_logs) ? mood_logs : [],
      deadlines: Array.isArray(deadlines) ? deadlines : [],
    },
    counts: {
      syllabus: Array.isArray(syllabus) ? syllabus.length : 0,
      schedule: Array.isArray(schedule) ? schedule.length : 0,
      habits: Array.isArray(habits) ? habits.length : 0,
      habit_logs: Array.isArray(habit_logs) ? habit_logs.length : 0,
      workout_logs: Array.isArray(workout_logs) ? workout_logs.length : 0,
    },
  };
}

export function backupToJsonString(data) {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return JSON.stringify({ error: 'stringify failed', exportedAt: new Date().toISOString() });
  }
}

// For testing: ensure all required collections present
export function validateBackupData(backup) {
  if (!backup || typeof backup !== 'object') return false;
  if (!backup.collections) return false;
  const required = ['syllabus', 'schedule', 'habits', 'workout_logs'];
  for (const k of required) {
    if (!Array.isArray(backup.collections[k])) return false;
  }
  // profile can be null but should exist key
  if (!('profile' in backup)) return false;
  return true;
}
