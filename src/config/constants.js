// ============================================================
// StudentOS — central config & constants
// One source of truth for app identity, XP rules, tiers,
// onboarding options and bundled content presets.
// ============================================================

export const APP_NAME = 'StudentOS';
export const APP_TAGLINE = 'Level Up Your Life. One Quest at a Time.';
export const APP_VERSION = '1.0.0';

// ---------- AI ----------
// 'gemini' | 'groq' — switch provider here, or at runtime in Settings.
export const AI_PROVIDER = (process.env.EXPO_PUBLIC_AI_PROVIDER || 'gemini').toLowerCase();
export const AI_MODELS = {
  gemini: 'gemini-2.0-flash',
  groq: 'llama-3.3-70b-versatile',
};

// ============================================================
// XP & GAMIFICATION
// ============================================================
export const LEVEL_XP_STEP = 100; // XP required per level (configurable)

// Central XP rulebook — every feature awards XP through xpService
// so points stay consistent across the app.
export const XP_RULES = {
  DAILY_LOGIN: { amount: 5, category: 'misc', label: 'Daily login' },
  FOCUS_SESSION: { amount: 0, perMinute: 1, category: 'study', label: 'Focus session' }, // XP = minutes focused
  STUDY_QUEST: { amount: 30, category: 'study', label: 'Quest complete' },
  SYLLABUS_TOPIC: { amount: 15, category: 'study', label: 'Topic done' },
  CHAPTER_COMPLETE: { amount: 100, category: 'study', label: 'Chapter conquered' },
  QUIZ_COMPLETE: { amount: 20, category: 'study', label: 'Quiz complete' },
  QUIZ_EXCELLENT: { amount: 50, category: 'study', label: '90%+ score!' },
  FLASHCARD_CREATE: { amount: 10, category: 'study', label: 'Flashcard created' },
  FLASHCARD_REVIEW: { amount: 15, category: 'study', label: 'Flashcards reviewed' },
  NOTE_CREATE: { amount: 5, category: 'study', label: 'Note saved' },
  HABIT: { amount: 10, category: 'habit', label: 'Habit done' },
  MOOD_CHECKIN: { amount: 5, category: 'habit', label: 'Mood check-in' },
  WORKOUT: { amount: 30, category: 'gym', label: 'Workout logged' },
  ARENA_CORRECT: { amount: 10, category: 'social', label: 'Arena answer' },
  ARENA_COMPLETE: { amount: 20, category: 'social', label: 'Daily Arena done' },
  BATTLE_COMPLETE: { amount: 25, category: 'social', label: 'Battle fought' },
  BATTLE_WIN: { amount: 60, category: 'social', label: 'Battle won!' },
};

export const TIERS = [
  { name: 'Bronze', min: 0, max: 5000, color: '#CD7F32', icon: '🥉' },
  { name: 'Silver', min: 5000, max: 15000, color: '#C0C0C0', icon: '🥈' },
  { name: 'Gold', min: 15000, max: 30000, color: '#FFD700', icon: '🥇' },
  { name: 'Diamond', min: 30000, max: 60000, color: '#22D3EE', icon: '💎' },
  { name: 'Master', min: 60000, max: 100000, color: '#A78BFA', icon: '👑' },
  { name: 'Legendary', min: 100000, max: 150000, color: '#F59E0B', icon: '🌟' },
  { name: 'Grandmaster', min: 150000, max: Infinity, color: '#EF4444', icon: '⚡' },
];

export const STREAK_FREEZE_START = 2; // freezes a new player starts with
export const STREAK_FREEZE_MAX = 3;
export const STREAK_FREEZE_EARN_EVERY = 7; // earn +1 freeze every 7-day streak

// ============================================================
// SCHEDULE / SESSIONS
// ============================================================
export const SESSION_TYPES = {
  study: { label: 'Study', icon: '📖', color: '#7C3AED' },
  revision: { label: 'Revision', icon: '🔁', color: '#0891B2' },
  practice: { label: 'Timed Practice', icon: '⏱️', color: '#EC4899' },
  quiz: { label: 'Quiz', icon: '🧠', color: '#10B981' },
  mock: { label: 'Mock Test', icon: '📝', color: '#F59E0B' },
  gym: { label: 'Gym', icon: '💪', color: '#EF4444' },
  break: { label: 'Break', icon: '☕', color: '#64748B' },
};

// Track priorities for the scheduler: class syllabus ALWAYS wins,
// olympiad second, competitive exam last (optional/leisure layer).
export const TRACK_PRIORITY = { class: 1, olympiad: 2, exam: 3 };

// Empathetic focus quotes — shown ~every 20 min of a focus session.
// Supportive, never guilt-tripping. Rotated in order.
export const FOCUS_QUOTES = [
  "Pace yourself — progress over perfection. You're doing great.",
  'One step at a time. You\u2019ve got this.',
  'Hard work now, freedom later. Keep going.',
  "It's okay to feel tired — that means you're trying. Rest when the session ends.",
  'Every focused minute is XP you\u2019ll never lose. Stay with it.',
  'Your future self is already saying thanks. 🙏',
  'Small consistent steps beat big rare leaps. You\u2019re on track.',
  'Breathe. You don\u2019t need to rush — you need to continue.',
  'Consistency is your superpower, and it\u2019s charging right now.',
  'You showed up today. That\u2019s already half the win.',
];

export const FOCUS_MODES = {
  classic: { label: 'Classic 25/5', focus: 25, break: 5, hint: 'The OG Pomodoro' },
  sprint: { label: 'Quick Sprint 15/3', focus: 15, break: 3, hint: 'Chhota packet, bada dhamaka' },
  deep: { label: 'Deep Focus 90/20', focus: 90, break: 20, hint: 'For the hardcore' },
  custom: { label: 'Custom', focus: 30, break: 5, hint: 'Tune it your way' },
};

export const SUBJECT_COLORS = [
  '#7C3AED', '#0891B2', '#10B981', '#F59E0B', '#EF4444',
  '#EC4899', '#6366F1', '#14B8A6', '#F97316', '#8B5CF6',
  '#0EA5E9', '#84CC16',
];

// ============================================================
// ONBOARDING OPTIONS
// ============================================================
export const CLASS_GROUPS = [
  { id: 'middle', label: 'Middle School', hint: 'Class 6–8', classes: ['Class 6', 'Class 7', 'Class 8'], showBoard: false },
  { id: 'high', label: 'High School', hint: 'Class 9–10', classes: ['Class 9', 'Class 10'], showBoard: true },
  { id: 'senior', label: 'Senior Secondary', hint: 'Class 11–12', classes: ['Class 11', 'Class 12'], showBoard: true },
  { id: 'college', label: 'College', hint: 'UG / PG / Diploma', classes: ['1st Year', '2nd Year', '3rd Year', '4th Year'], showBoard: false },
];

export const BOARDS = ['CBSE', 'ICSE', 'State Board', 'IB', 'IGCSE', 'Other'];

export const EXAMS = [
  'None', 'JEE Main', 'JEE Advanced', 'NEET', 'NTSE', 'KVPY / INSPIRE',
  'UPSC', 'CAT', 'GATE', 'CLAT', 'CUET', 'Other',
];

export const OLYMPIADS = [
  'None', 'IMO (Maths)', 'NSO (Science)', 'IOQM', 'NSEP (Physics)',
  'NSEC (Chemistry)', 'INMO', 'ZCO / ICO (Coding)', 'Other',
];

export const PREP_LEVELS = [
  'Just starting out',
  'Building basics',
  'Intermediate — steady padhai',
  'Advanced — strong hold',
  'Final revision mode',
];

export const STUDY_TIMES = [
  'Early morning (5–8 AM)',
  'Morning (8–11 AM)',
  'Afternoon (12–4 PM)',
  'Evening (4–7 PM)',
  'Night (7–11 PM)',
  'Late night (11 PM+)',
];

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ============================================================
// PRELOADED HABITS (grouped by part of day)
// ============================================================
export const HABIT_PRESETS = [
  { name: 'Wake up by 6:30 AM', category: 'health', icon: '🌅', part: 'morning', target_time: '06:30' },
  { name: "Revise yesterday's topics (10 min)", category: 'academic', icon: '📖', part: 'morning', target_time: '07:00' },
  { name: 'Meditation / pranayama (5 min)', category: 'mental', icon: '🧘', part: 'morning', target_time: '07:15' },
  { name: 'No phone for first 30 min', category: 'productivity', icon: '📵', part: 'morning', target_time: '07:30' },
  { name: "Complete today's quests", category: 'academic', icon: '🎯', part: 'afternoon', target_time: '16:00' },
  { name: 'Drink 3L water', category: 'health', icon: '💧', part: 'afternoon', target_time: '17:00' },
  { name: 'Power nap (20 min)', category: 'health', icon: '😴', part: 'afternoon', target_time: '14:30' },
  { name: 'Finish homework before evening', category: 'academic', icon: '✏️', part: 'afternoon', target_time: '17:30' },
  { name: 'Journal + plan tomorrow', category: 'productivity', icon: '📓', part: 'evening', target_time: '21:30' },
  { name: 'Read 10 pages (non-syllabus)', category: 'mental', icon: '📚', part: 'evening', target_time: '22:00' },
  { name: 'No phone after 10 PM', category: 'productivity', icon: '🌙', part: 'evening', target_time: '22:00' },
  { name: 'Sleep by 11 PM', category: 'health', icon: '🛏️', part: 'evening', target_time: '23:00' },
];

export const HABIT_CATEGORIES = {
  academic: { label: 'Academic', color: '#7C3AED', icon: '📘' },
  health: { label: 'Health', color: '#10B981', icon: '🫀' },
  mental: { label: 'Mental', color: '#0891B2', icon: '🧠' },
  productivity: { label: 'Productivity', color: '#F59E0B', icon: '⚡' },
};

// ============================================================
// GYM / WORKOUT PLANS
// ============================================================
export const GYM_PLANS = {
  home: {
    name: 'Home Workout',
    hint: 'No equipment — ghar pe hi ho jayega',
    exercises: [
      { name: 'Push-ups', sets: 3, reps: '10–15' },
      { name: 'Bodyweight Squats', sets: 3, reps: '20' },
      { name: 'Lunges', sets: 3, reps: '12 each leg' },
      { name: 'Plank', sets: 3, reps: '45 sec' },
      { name: 'Mountain Climbers', sets: 3, reps: '30 sec' },
    ],
  },
  beginner: {
    name: 'Beginner Gym',
    hint: 'Form pe focus, weight baad mein',
    exercises: [
      { name: 'Lat Pulldown', sets: 3, reps: '12' },
      { name: 'Chest Press', sets: 3, reps: '12' },
      { name: 'Leg Press', sets: 3, reps: '12' },
      { name: 'Dumbbell Shoulder Press', sets: 3, reps: '12' },
      { name: 'Bicep Curls', sets: 2, reps: '12' },
      { name: 'Treadmill Walk', sets: 1, reps: '15 min' },
    ],
  },
  intermediate: {
    name: 'Intermediate Gym',
    hint: 'Push / Pull / Legs style',
    exercises: [
      { name: 'Bench Press', sets: 4, reps: '8–10' },
      { name: 'Deadlift', sets: 4, reps: '6–8' },
      { name: 'Squat', sets: 4, reps: '8–10' },
      { name: 'Barbell Row', sets: 4, reps: '10' },
      { name: 'Overhead Press', sets: 3, reps: '10' },
      { name: 'Pull-ups', sets: 3, reps: 'Max' },
    ],
  },
  advanced: {
    name: 'Advanced Gym',
    hint: 'Heavy volume — thoda aur push',
    exercises: [
      { name: 'Bench Press', sets: 5, reps: '5–6' },
      { name: 'Squat', sets: 5, reps: '5–6' },
      { name: 'Deadlift', sets: 5, reps: '4–5' },
      { name: 'Weighted Pull-ups', sets: 4, reps: '6–8' },
      { name: 'Barbell Row', sets: 4, reps: '8' },
      { name: 'Dips', sets: 4, reps: '10–12' },
      { name: 'Hanging Leg Raise', sets: 3, reps: '15' },
    ],
  },
};

// ============================================================
// QUOTES (Daily wisdom — works fully offline)
// ============================================================
export const QUOTES = [
  { text: 'Dream, dream, dream. Dreams transform into thoughts and thoughts result in action.', author: 'Dr. A.P.J. Abdul Kalam' },
  { text: 'Arise! Awake! and stop not until the goal is reached.', author: 'Swami Vivekananda' },
  { text: 'It does not matter how slowly you go as long as you do not stop.', author: 'Confucius' },
  { text: 'The future depends on what you do today.', author: 'Mahatma Gandhi' },
  { text: 'Small daily improvements are the key to staggering long-term results.', author: 'Robin Sharma' },
  { text: 'You don’t have to be great to start, but you have to start to be great.', author: 'Zig Ziglar' },
  { text: 'Padhai is not a sprint, it’s a marathon with water breaks.', author: 'Professor Byte' },
  { text: 'Discipline is choosing between what you want now and what you want most.', author: 'Abraham Lincoln' },
  { text: 'A person who never made a mistake never tried anything new.', author: 'Albert Einstein' },
  { text: 'Winners are not people who never fail, but people who never quit.', author: 'Dr. A.P.J. Abdul Kalam' },
  { text: 'One chapter a day keeps the backlog away.', author: 'Professor Byte' },
  { text: 'Your only limit is you. Push past it — ek aur rep!', author: 'Unknown' },
  { text: 'The expert in anything was once a beginner.', author: 'Helen Hayes' },
  { text: 'Success is the sum of small efforts repeated day in and day out.', author: 'Robert Collier' },
  { text: 'Do something today that your future self will thank you for.', author: 'Sean Patrick Flanery' },
  { text: 'Study while others are sleeping; work while others are loafing.', author: 'William A. Ward' },
  { text: 'Mistakes are proof that you are trying.', author: 'Unknown' },
  { text: 'The best way to predict the future is to create it.', author: 'Peter Drucker' },
  { text: 'Focus on being productive instead of busy.', author: 'Tim Ferriss' },
  { text: 'A calm mind brings inner strength and self-confidence.', author: 'Dalai Lama' },
  { text: 'Karlo yaar, ek focus session — baaki sab automatic.', author: 'Professor Byte' },
  { text: 'Energy and persistence conquer all things.', author: 'Benjamin Franklin' },
  { text: 'Don’t watch the clock; do what it does. Keep going.', author: 'Sam Levenson' },
  { text: 'You are what you do, not what you say you’ll do.', author: 'Carl Jung' },
  { text: 'Great things are done by a series of small things brought together.', author: 'Vincent Van Gogh' },
  { text: 'Believe you can and you’re halfway there.', author: 'Theodore Roosevelt' },
  { text: 'It always seems impossible until it’s done.', author: 'Nelson Mandela' },
  { text: 'Strive for progress, not perfection.', author: 'Unknown' },
  { text: 'Your habits decide your future. Choose wisely.', author: 'Unknown' },
  { text: 'Knowledge is the best investment — returns guaranteed.', author: 'Professor Byte' },
  { text: 'Fall seven times, stand up eight.', author: 'Japanese Proverb' },
  { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
  { text: 'Quality means doing it right when no one is looking.', author: 'Henry Ford' },
  { text: 'Sleep well, study well, play well. Balance hi asli game hai.', author: 'Professor Byte' },
  { text: 'Motivation gets you going, habit keeps you going.', author: 'Jim Ryun' },
  { text: 'Every accomplishment starts with the decision to try.', author: 'John F. Kennedy' },
];

// ============================================================
// SYLLABUS PRESETS (bundled starter syllabi)
// Format: rows of { subject, chapter, weightage (0-5), estimated_hours }
// ============================================================
export const SYLLABUS_PRESETS = {
  'class10_cbse': {
    label: 'Class 10 · CBSE (Science + Maths)',
    rows: [
      { subject: 'Science', chapter: 'Chemical Reactions and Equations', weightage: 4, estimated_hours: 6 },
      { subject: 'Science', chapter: 'Acids, Bases and Salts', weightage: 4, estimated_hours: 7 },
      { subject: 'Science', chapter: 'Metals and Non-metals', weightage: 4, estimated_hours: 8 },
      { subject: 'Science', chapter: 'Life Processes', weightage: 5, estimated_hours: 10 },
      { subject: 'Science', chapter: 'Control and Coordination', weightage: 3, estimated_hours: 7 },
      { subject: 'Science', chapter: 'How do Organisms Reproduce?', weightage: 4, estimated_hours: 8 },
      { subject: 'Science', chapter: 'Light — Reflection and Refraction', weightage: 5, estimated_hours: 10 },
      { subject: 'Science', chapter: 'Electricity', weightage: 5, estimated_hours: 10 },
      { subject: 'Science', chapter: 'Our Environment', weightage: 2, estimated_hours: 4 },
      { subject: 'Maths', chapter: 'Real Numbers', weightage: 3, estimated_hours: 6 },
      { subject: 'Maths', chapter: 'Polynomials', weightage: 3, estimated_hours: 6 },
      { subject: 'Maths', chapter: 'Pair of Linear Equations', weightage: 4, estimated_hours: 8 },
      { subject: 'Maths', chapter: 'Quadratic Equations', weightage: 4, estimated_hours: 8 },
      { subject: 'Maths', chapter: 'Arithmetic Progressions', weightage: 3, estimated_hours: 6 },
      { subject: 'Maths', chapter: 'Triangles', weightage: 4, estimated_hours: 8 },
      { subject: 'Maths', chapter: 'Coordinate Geometry', weightage: 3, estimated_hours: 6 },
      { subject: 'Maths', chapter: 'Trigonometry', weightage: 5, estimated_hours: 10 },
      { subject: 'Maths', chapter: 'Statistics and Probability', weightage: 3, estimated_hours: 7 },
    ],
  },
  'class12_pcm': {
    label: 'Class 11–12 · PCM (JEE base)',
    rows: [
      { subject: 'Physics', chapter: 'Units, Dimensions and Errors', weightage: 2, estimated_hours: 5 },
      { subject: 'Physics', chapter: 'Kinematics', weightage: 4, estimated_hours: 10 },
      { subject: 'Physics', chapter: 'Laws of Motion', weightage: 4, estimated_hours: 10 },
      { subject: 'Physics', chapter: 'Work, Energy and Power', weightage: 4, estimated_hours: 9 },
      { subject: 'Physics', chapter: 'Rotational Motion', weightage: 5, estimated_hours: 14 },
      { subject: 'Physics', chapter: 'Thermodynamics', weightage: 5, estimated_hours: 12 },
      { subject: 'Physics', chapter: 'Electrostatics', weightage: 5, estimated_hours: 14 },
      { subject: 'Physics', chapter: 'Current Electricity', weightage: 5, estimated_hours: 12 },
      { subject: 'Physics', chapter: 'Magnetism and EMI', weightage: 5, estimated_hours: 14 },
      { subject: 'Physics', chapter: 'Optics', weightage: 4, estimated_hours: 12 },
      { subject: 'Physics', chapter: 'Modern Physics', weightage: 5, estimated_hours: 10 },
      { subject: 'Chemistry', chapter: 'Mole Concept and Stoichiometry', weightage: 4, estimated_hours: 10 },
      { subject: 'Chemistry', chapter: 'Atomic Structure', weightage: 4, estimated_hours: 8 },
      { subject: 'Chemistry', chapter: 'Chemical Bonding', weightage: 5, estimated_hours: 10 },
      { subject: 'Chemistry', chapter: 'Thermodynamics and Equilibrium', weightage: 5, estimated_hours: 14 },
      { subject: 'Chemistry', chapter: 'Electrochemistry', weightage: 4, estimated_hours: 10 },
      { subject: 'Chemistry', chapter: 'Chemical Kinetics', weightage: 4, estimated_hours: 8 },
      { subject: 'Chemistry', chapter: 'p-Block Elements', weightage: 4, estimated_hours: 12 },
      { subject: 'Chemistry', chapter: 'Organic Chemistry — GOC', weightage: 5, estimated_hours: 14 },
      { subject: 'Chemistry', chapter: 'Organic — Hydrocarbons & Haloalkanes', weightage: 4, estimated_hours: 12 },
      { subject: 'Maths', chapter: 'Sets, Relations and Functions', weightage: 3, estimated_hours: 8 },
      { subject: 'Maths', chapter: 'Complex Numbers and Quadratic Equations', weightage: 4, hours: 10, estimated_hours: 10 },
      { subject: 'Maths', chapter: 'Sequences and Series', weightage: 3, estimated_hours: 8 },
      { subject: 'Maths', chapter: 'Permutations and Combinations', weightage: 3, estimated_hours: 8 },
      { subject: 'Maths', chapter: 'Binomial Theorem', weightage: 3, estimated_hours: 6 },
      { subject: 'Maths', chapter: 'Matrices and Determinants', weightage: 5, estimated_hours: 12 },
      { subject: 'Maths', chapter: 'Limits, Continuity and Differentiability', weightage: 5, estimated_hours: 14 },
      { subject: 'Maths', chapter: 'Applications of Derivatives & Integrals', weightage: 5, hours: 16, estimated_hours: 16 },
      { subject: 'Maths', chapter: 'Probability', weightage: 4, estimated_hours: 10 },
      { subject: 'Maths', chapter: 'Vectors and 3D Geometry', weightage: 5, estimated_hours: 12 },
    ],
  },
  'neet_bio': {
    label: 'NEET · Biology (NCERT)',
    rows: [
      { subject: 'Biology', chapter: 'Cell — The Unit of Life', weightage: 5, estimated_hours: 10 },
      { subject: 'Biology', chapter: 'Biomolecules', weightage: 4, estimated_hours: 8 },
      { subject: 'Biology', chapter: 'Plant Physiology', weightage: 5, estimated_hours: 14 },
      { subject: 'Biology', chapter: 'Human Physiology', weightage: 5, estimated_hours: 18 },
      { subject: 'Biology', chapter: 'Reproduction', weightage: 5, estimated_hours: 14 },
      { subject: 'Biology', chapter: 'Genetics and Evolution', weightage: 5, estimated_hours: 16 },
      { subject: 'Biology', chapter: 'Biology and Human Welfare', weightage: 3, estimated_hours: 8 },
      { subject: 'Biology', chapter: 'Biotechnology', weightage: 4, estimated_hours: 10 },
      { subject: 'Biology', chapter: 'Ecology and Environment', weightage: 5, estimated_hours: 12 },
    ],
  },
  'foundation': {
    label: 'Class 6–8 · Foundation (Science + Maths)',
    rows: [
      { subject: 'Science', chapter: 'Food and Nutrition', weightage: 3, estimated_hours: 4 },
      { subject: 'Science', chapter: 'Acids, Bases and Salts (basics)', weightage: 3, estimated_hours: 4 },
      { subject: 'Science', chapter: 'Motion and Time', weightage: 4, estimated_hours: 6 },
      { subject: 'Science', chapter: 'Light and Shadow', weightage: 3, estimated_hours: 4 },
      { subject: 'Science', chapter: 'Cell Structure', weightage: 4, estimated_hours: 5 },
      { subject: 'Maths', chapter: 'Integers and Fractions', weightage: 4, estimated_hours: 6 },
      { subject: 'Maths', chapter: 'Algebraic Expressions', weightage: 4, estimated_hours: 6 },
      { subject: 'Maths', chapter: 'Ratio and Proportion', weightage: 3, estimated_hours: 5 },
      { subject: 'Maths', chapter: 'Geometry — Lines and Angles', weightage: 3, estimated_hours: 5 },
      { subject: 'Maths', chapter: 'Data Handling', weightage: 2, estimated_hours: 4 },
    ],
  },
};

// ============================================================
// MISC
// ============================================================
export const CONTENT_TYPES = {
  note: { label: 'Note', icon: '📝' },
  link: { label: 'Link', icon: '🔗' },
  pdf: { label: 'PDF', icon: '📄' },
  image: { label: 'Image', icon: '🖼️' },
  youtube: { label: 'YouTube', icon: '▶️' },
  audio: { label: 'Audio', icon: '🎧' },
};

export const MOODS = [
  { value: 1, emoji: '😫', label: 'Drained' },
  { value: 2, emoji: '😕', label: 'Low' },
  { value: 3, emoji: '😐', label: 'Theek hai' },
  { value: 4, emoji: '🙂', label: 'Accha' },
  { value: 5, emoji: '😄', label: 'On top!' },
];
