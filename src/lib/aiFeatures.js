// ============================================================
// StudentOS — AI feature functions
// Every AI feature lives here and calls ONLY aiService.askAI /
// askAIJSON. Each function degrades gracefully: if AI is offline
// or unconfigured it throws AIUnavailableError which callers catch
// and fall back to the offline engines.
// ============================================================
import { askAI, askAIJSON, AIUnavailableError, AI_PERSONA } from './aiService';

export { AIUnavailableError };

const esc = (s) => String(s ?? '').slice(0, 400);

// ---------- shared, class-aware context (used by EVERY feature) ----------
// The student's class is non-negotiable context: a Class 10 student
// must get Class-10-level answers, never Class 12 or generic trivia.
export function buildProfileContext(profile = {}) {
  const bits = [];
  if (profile.class_level) bits.push(String(profile.class_level));
  if (profile.board) bits.push(String(profile.board));
  if (profile.competitive_exam && profile.competitive_exam !== 'None') {
    bits.push(`preparing for ${profile.competitive_exam}${profile.exam_date ? ` (${profile.exam_date})` : ''}`);
  }
  if (profile.olympiad && profile.olympiad !== 'None') {
    bits.push(`olympiad: ${profile.olympiad}${profile.olympiad_date ? ` (${profile.olympiad_date})` : ''}`);
  }
  if (profile.prep_level) bits.push(`level: ${profile.prep_level}`);
  return bits.join(' · ');
}

function classGuard(profileContext = '') {
  return `IMPORTANT: match the student's class level exactly — ${
    profileContext || 'an Indian school student'
  }. Questions/answers must be at THAT class level (NCERT-style), not higher, not trivia.`;
}

// ---------- Professor Byte chat ----------
export async function aiTutorReply({ history = [], message, context = '' }) {
  const convo = history
    .slice(-8)
    .map((m) => `${m.role === 'user' ? 'Student' : 'Professor Byte'}: ${m.content}`)
    .join('\n');
  const prompt = [
    context ? `Student context: ${esc(context)}` : '',
    convo ? `Recent conversation:\n${convo}` : '',
    `Student: ${message}`,
    'Professor Byte:',
  ]
    .filter(Boolean)
    .join('\n\n');

  return askAI({
    prompt,
    system: `${AI_PERSONA}
You are chatting in the AI Tutor screen. You can explain concepts simply, solve problems step-by-step, quiz the student, summarize chapters, plan study strategy and motivate. Use bullet points and short paragraphs. If the student asks something unrelated to studying, gently steer back with warmth and one fun line. Max ~180 words unless solving a problem needs more.`,
    temperature: 0.7,
  });
}

export async function aiMotivate({ name = 'champ', streak = 0, context = '' }) {
  return askAI({
    prompt: `Give a 2-line motivational pep talk in Hinglish-flavored English for ${name}, who has a ${streak}-day streak. Context: ${esc(context)}. End with one concrete tiny next step.`,
    system: AI_PERSONA,
    temperature: 0.9,
    noCache: true,
  });
}

// ---------- personalized daily morning message (Home) ----------
// Uses the student's REAL schedule for today + weak areas + streak.
export async function aiDailyMessage({ profile = {}, todaySessions = [], weakAreas = [], streak = 0, xp = 0, habitsPending = 0 }) {
  const ctx = buildProfileContext(profile);
  const plan = todaySessions.length
    ? todaySessions
        .slice(0, 6)
        .map((s) => `${s.start_time || ''} ${s.subject} — ${s.topic || ''} (${s.session_type || 'study'})`)
        .join('; ')
    : 'no sessions planned (rest day or not generated yet)';
  const weak = weakAreas.length ? weakAreas.slice(0, 5).join(', ') : 'none flagged yet';
  return askAI({
    prompt: `Write today's morning message for this student (they'll see it as a small card on the Home screen).
Student: ${esc(ctx)}.
Today's plan: ${esc(plan)}.
Weak areas (from quiz mistakes): ${esc(weak)}.
Streak: ${streak} days · XP: ${xp}${habitsPending ? ` · ${habitsPending} habits pending today` : ''}.
Rules: 1) 2-3 lines max, warm + specific, Hinglish flavor ok. 2) Reference at least one REAL item from their plan or weak areas by name. 3) End with one tiny concrete action for right now. No greetings like "Dear student".`,
    system: AI_PERSONA,
    temperature: 0.8,
    noCache: true,
  });
}

// ---------- AI-suggested habits (Habits screen) ----------
export async function aiSuggestHabits({ profile = {}, existingHabits = [], goals = '' }) {
  const ctx = buildProfileContext(profile);
  const existing = existingHabits.slice(0, 15).map((h) => h.name).join('; ');
  const data = await askAIJSON({
    prompt: `Suggest 4 new daily habits for this student that complement (not duplicate) their existing habits.
Student: ${esc(ctx)}.
Existing habits: ${esc(existing) || 'none'}.
Goals/notes: ${esc(goals) || 'better consistency'}.
Habits should be: tiny (2-10 min), concrete, class-relevant (e.g. a Class 10 JEE aspirant gets different habits than a Class 6 student), and healthy (sleep, movement, revision micro-routines).
Return JSON: {"habits":[{"name":"...","icon":"one emoji","category":"health|study|mind|life","part":"morning|day|evening|night","target_time":"HH:MM or null","why":"one short line"}]}`,
    system: AI_PERSONA,
    schemaHint: '{"habits":[{name, icon, category, part, target_time, why}]}',
    temperature: 0.7,
  });
  const habits = Array.isArray(data?.habits) ? data.habits : [];
  const clean = habits.filter((h) => h?.name).map((h) => ({
    name: String(h.name).slice(0, 60),
    icon: String(h.icon || '✨').slice(0, 4),
    category: ['health', 'study', 'mind', 'life'].includes(h.category) ? h.category : 'life',
    part: ['morning', 'day', 'evening', 'night'].includes(h.part) ? h.part : 'day',
    target_time: /^\d{2}:\d{2}$/.test(String(h.target_time || '')) ? h.target_time : null,
    why: String(h.why || '').slice(0, 120),
  }));
  if (!clean.length) throw new AIUnavailableError('AI habit suggestions nahi aaye.');
  return clean;
}

// ---------- quiz generation ----------
export async function aiGenerateQuiz({ subject, topic, count = 5, difficulty = 'medium', profileContext = '', syllabusChapters = [] }) {
  const chapterHint = syllabusChapters?.length
    ? `Generate from these chapters of the student's OWN syllabus: ${syllabusChapters.slice(0, 25).map(esc).join('; ')}.`
    : '';
  const data = await askAIJSON({
    prompt: `Create ${count} multiple-choice questions for an Indian student.
Subject: ${esc(subject) || 'General'}${topic ? ` · Topic: ${esc(topic)}` : ''}.
Difficulty: ${difficulty}. Mix conceptual + application questions.
${chapterHint}
${classGuard(profileContext)}
Return JSON: {"questions":[{"q":"...","options":["A","B","C","D"],"answer":0,"explanation":"one line why","topic":"subtopic name","difficulty":1}]}. "answer" is the 0-based index of the correct option. Options must be plausible and unambiguous.`,
    system: AI_PERSONA,
    schemaHint: '{"questions":[{q, options[4], answer, explanation, topic, difficulty}]}',
    temperature: 0.5,
  });
  const qs = Array.isArray(data?.questions) ? data.questions : [];
  const clean = qs
    .filter((q) => q?.q && Array.isArray(q?.options) && q.options.length >= 3)
    .map((q) => ({
      subject: subject || 'AI Quiz',
      topic: q.topic || topic || 'Mixed',
      difficulty: q.difficulty || 2,
      q: String(q.q),
      options: q.options.map(String),
      answer: Math.max(0, Math.min(q.options.length - 1, Number(q.answer) || 0)),
      explanation: String(q.explanation || ''),
      source: 'ai',
    }));
  if (!clean.length) throw new AIUnavailableError('AI ka quiz samajh nahi aaya — bank se laa raha hoon.');
  return clean;
}

// ---------- flashcard deck generation ----------
export async function aiGenerateFlashcards({ subject, topic, count = 8, profileContext = '' }) {
  const data = await askAIJSON({
    prompt: `Create ${count} flashcards for topic "${esc(topic)}" of subject "${esc(subject)}" for an Indian student.
${profileContext ? `Student: ${esc(profileContext)}.` : ''}
Mix card types: definitions, formulas, one-liner Q&A, and 1-2 "concept link" cards.
Return JSON: {"cards":[{"front":"...","back":"...","type":"qa|definition|formula|concept"}]}. Fronts must be crisp questions/prompts; backs must be self-contained answers.`,
    system: AI_PERSONA,
    schemaHint: '{"cards":[{front, back, type}]}',
    temperature: 0.4,
  });
  const cards = Array.isArray(data?.cards) ? data.cards : [];
  const clean = cards.filter((c) => c?.front && c?.back);
  if (!clean.length) throw new AIUnavailableError('AI deck generate nahi ho paya.');
  return clean.map((c) => ({
    front_text: String(c.front),
    back_text: String(c.back),
    card_type: c.type || 'qa',
  }));
}

// ---------- arena / battle challenges (class-aware!) ----------
// Arena & Battle questions come from the STUDENT'S OWN syllabus and
// class level — never generic trivia. Offline → static bank fallback.
export async function aiChallengeQuestions({ profile = {}, syllabusRows = [], count = 5, topic = '' }) {
  const ctx = buildProfileContext(profile);
  const chapters = syllabusRows.slice(0, 60).map((r) => r.chapter);
  const data = await askAIJSON({
    prompt: `Create ${count} rapid-fire multiple-choice questions for a daily challenge in a study game.
${classGuard(ctx)}
${chapters.length ? `From the student's OWN syllabus chapters: ${chapters.map(esc).join('; ')}.` : ''}
${topic ? `Focus topic: ${esc(topic)}.` : ''}
Difficulty should suit their prep level. Mix quick-recall + application.
Return JSON: {"questions":[{"q":"...","options":["A","B","C","D"],"answer":0,"explanation":"one line","topic":"chapter name","difficulty":2}]}`,
    system: AI_PERSONA,
    schemaHint: '{"questions":[{q, options[4], answer, explanation, topic, difficulty}]}',
    temperature: 0.6,
    noCache: true,
  });
  const qs = Array.isArray(data?.questions) ? data.questions : [];
  const clean = qs
    .filter((q) => q?.q && Array.isArray(q?.options) && q.options.length >= 3)
    .map((q) => ({
      subject: 'Challenge',
      topic: q.topic || topic || 'Mixed',
      difficulty: q.difficulty || 2,
      q: String(q.q),
      options: q.options.map(String),
      answer: Math.max(0, Math.min(q.options.length - 1, Number(q.answer) || 0)),
      explanation: String(q.explanation || ''),
      source: 'ai',
    }));
  if (clean.length < 3) throw new AIUnavailableError('AI challenge questions nahi mile.');
  return clean.slice(0, count);
}

// ---------- content summary ----------
export async function aiSummarizeContent({ title, text }) {
  const summary = await askAI({
    prompt: `Summarize this study material in 5-7 crisp bullet points (max 90 words total). Keep key formulas/terms. End with one line "Exam angle: …".\n\nTitle: ${esc(title)}\n\nContent:\n${String(text).slice(0, 6000)}`,
    system: AI_PERSONA,
    temperature: 0.3,
  });
  return summary.trim();
}

// ---------- adaptive rescheduling ----------
// AI proposes adjustments for missed sessions / behind-schedule student.
export async function aiReschedule({ missed = [], upcomingCount = 0, examDate, dailyHours, behindTopics = [] }) {
  const data = await askAIJSON({
    prompt: `A student missed ${missed.length} study sessions (topics: ${missed.map((m) => esc(m.topic || m.subject)).join('; ').slice(0, 300)}).
They have ${upcomingCount} upcoming sessions, study ${dailyHours} hrs/day${examDate ? `, exam on ${examDate}` : ''}.
Weak/behind topics: ${behindTopics.map(esc).join(', ').slice(0, 200) || 'unknown'}.
Propose which topics to prioritise in the next 7 days and what to drop/merge.
Return JSON: {"moves":[{"topic":"...","action":"prioritise|merge|drop|keep","reason":"short"},"advice":"one warm line"}. Max 6 moves.`,
    system: AI_PERSONA,
    schemaHint: '{"moves":[{topic, action, reason}],"advice":"..."}',
    temperature: 0.4,
  });
  if (!data || !Array.isArray(data.moves)) throw new AIUnavailableError('AI reschedule plan nahi ban paya.');
  return data;
}

// ---------- weekly reflection ----------
export async function aiWeeklyReflection({ moods = [], habitsDone = 0, habitsTotal = 0, focusMinutes = 0, xp = 0 }) {
  const data = await askAIJSON({
    prompt: `Weekly recap for a student:
- Mood check-ins (1-5): ${moods.join(', ') || 'none'}
- Habits completed: ${habitsDone}/${habitsTotal}
- Focus minutes: ${focusMinutes}
- XP earned: ${xp}
Write a kind, honest weekly reflection: 1) summary (2-3 lines, Hinglish flavor ok), 2) one win to celebrate, 3) one gentle improvement area, 4) next week ke liye ek concrete plan.
Return JSON: {"summary":"...","win":"...","improve":"...","plan":"..."}`,
    system: AI_PERSONA,
    schemaHint: '{"summary":"","win":"","improve":"","plan":""}',
    temperature: 0.6,
  });
  if (!data?.summary) throw new AIUnavailableError('Weekly reflection nahi ban payi.');
  return data;
}

// ---------- syllabus generation ----------
export async function aiGenerateSyllabus({ classLevel, board, exam, subjects = '' }) {
  const data = await askAIJSON({
    prompt: `Create a study syllabus for an Indian student: Class ${esc(classLevel)} ${esc(board)}${exam ? `, preparing for ${esc(exam)}` : ''}. ${subjects ? `Focus subjects: ${esc(subjects)}.` : ''}
List 12-20 chapters with realistic weightage (1-5) and estimated hours.
Return JSON: {"rows":[{"subject":"...","chapter":"...","weightage":4,"estimated_hours":8}]}`,
    system: AI_PERSONA,
    schemaHint: '{"rows":[{subject, chapter, weightage, estimated_hours}]}',
    temperature: 0.3,
  });
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const clean = rows.filter((r) => r?.subject && r?.chapter);
  if (!clean.length) throw new AIUnavailableError('AI syllabus nahi bana.');
  return clean.map((r) => ({
    subject: String(r.subject),
    chapter: String(r.chapter),
    weightage: Math.max(1, Math.min(5, Number(r.weightage) || 3)),
    estimated_hours: Math.max(0.5, Number(r.estimated_hours) || 6),
  }));
}

// ---------- mood-aware reply ----------
export async function aiMoodReply({ mood, note = '' }) {
  return askAI({
    prompt: `A student just logged evening mood ${mood}/5${note ? ` and wrote: "${esc(note)}"` : ''}. Reply in 2-3 warm lines: acknowledge the feeling, one tiny helpful suggestion (or celebration if mood is high). Never preachy.`,
    system: AI_PERSONA,
    temperature: 0.8,
    noCache: true,
  });
}
