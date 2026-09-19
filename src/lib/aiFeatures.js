// ============================================================
// StudentOS — AI feature functions
// Every AI feature lives here and calls ONLY aiService.askAI /
// askAIJSON. Each function degrades gracefully: if AI is offline
// or unconfigured it throws AIUnavailableError which callers catch
// and fall back to the offline engines.
// v1.0.6 recovery: robust normalization, count validation, retry
// ============================================================
import { askAI, askAIJSON, AIUnavailableError, AI_PERSONA } from './aiService';

export { AIUnavailableError };

const esc = (s) => String(s ?? '').slice(0, 400);

// ---------- shared, class-aware context (used by EVERY feature) ----------
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
    system: `${AI_PERSONA}\nYou are chatting in the AI Tutor screen. You can explain concepts simply, solve problems step-by-step, quiz the student, summarize chapters, plan study strategy and motivate. Use bullet points and short paragraphs. If the student asks something unrelated to studying, gently steer back with warmth and one fun line. Max ~180 words unless solving a problem needs more.`,
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
    category: { health: 'health', study: 'academic', mind: 'mental', life: 'productivity', academic: 'academic', mental: 'mental', productivity: 'productivity' }[h.category] || 'productivity',
    part: { morning: 'morning', day: 'afternoon', afternoon: 'afternoon', evening: 'evening', night: 'evening' }[h.part] || 'afternoon',
    target_time: /^\d{2}:\d{2}$/.test(String(h.target_time || '')) ? h.target_time : null,
    why: String(h.why || '').slice(0, 120),
  }));
  if (!clean.length) throw new AIUnavailableError('AI habit suggestions nahi aaye.');
  return clean;
}

// LOW-9 (audit): never blindly trust Number(q.answer). Models sometimes
// reply 1-based indices or the option text. Resolve by matching the
// answer text against the options first, then fall back to the number.
function resolveAnswerIndex(q) {
  const options = Array.isArray(q.options) ? q.options.map(String) : [];
  const at = String(q.answer_text ?? q.answerText ?? q.answer ?? '').trim();

  // Try letter a/b/c/d
  const letterMatch = at.toLowerCase().match(/^[a-d]$/);
  if (letterMatch) {
    return letterMatch[0].charCodeAt(0) - 97;
  }
  // Try matching answer_text against options
  if (at) {
    const i = options.findIndex(
      (o) => o.trim().toLowerCase() === at.toLowerCase() || o.trim().toLowerCase().startsWith(at.toLowerCase()) || at.toLowerCase().startsWith(o.trim().toLowerCase())
    );
    if (i >= 0) return i;
  }
  const n = Number(q.answer);
  if (Number.isInteger(n) && n >= 0 && n < options.length) return n;
  if (Number.isInteger(n) && n >= 1 && n <= options.length) return n - 1;
  // Try answer as letter in options like "a", "b"
  if (typeof q.answer === 'string') {
    const l = q.answer.trim().toLowerCase();
    if (l.length === 1 && l >= 'a' && l <= 'd') return l.charCodeAt(0) - 97;
  }
  return 0;
}

function normalizeQuestionShape(q, subject, topic, difficultyDefault) {
  if (!q) return null;
  const qText = q.q || q.question || q.text || q.prompt || q.title || '';
  if (!qText || typeof qText !== 'string' || qText.trim().length < 3) return null;

  let options = [];
  if (Array.isArray(q.options)) options = q.options;
  else if (Array.isArray(q.choices)) options = q.choices;
  else if (q.options && typeof q.options === 'object') options = Object.values(q.options);
  else if (q.a && q.b) options = [q.a, q.b, q.c, q.d].filter(Boolean);

  options = options.map((o) => String(o).trim()).filter(Boolean);
  // v1.0.6 Y Round2: don't default typeless to MCQ
  const declaredType = String(q.type || '').toLowerCase();
  const hasOptions = options.length >= 2;
  let isMCQ = declaredType.includes('mcq') || (!declaredType && hasOptions);
  // For non-MCQ types, options may be empty — allow but ensure at least 2 for MCQ
  // Never discard valid text — downgrade to written
  if (isMCQ && options.length < 2) {
    isMCQ = false;
  }
  if (isMCQ) {
    while (options.length < 4) options.push(`Option ${options.length + 1}`);
    options = options.slice(0, 4);
  }

  const answerIdx = isMCQ ? resolveAnswerIndex({ ...q, options }) : 0;
  let finalType = declaredType || (isMCQ ? 'mcq' : 'saq');
  if (!['mcq','vsaq','saq','laq'].some(t => finalType.includes(t))) {
    finalType = isMCQ ? 'mcq' : 'saq';
  }

  return {
    subject: q.subject || subject || 'AI Quiz',
    topic: q.topic || topic || 'Mixed',
    difficulty: q.difficulty || difficultyDefault || 2,
    q: String(qText).slice(0, 600),
    options,
    answer: answerIdx,
    answer_text: options[answerIdx] || q.answer_text || q.answer || '',
    explanation: String(q.explanation || q.why || q.reason || '').slice(0, 400),
    marks: q.marks || 1,
    type: finalType,
    source: 'ai',
  };
}

// ---------- quiz generation — v1.0.6 recovery: filter FIRST, then limit, robust normalization ----------
export async function aiGenerateQuiz({ subject, topic, count = 5, difficulty = 'medium', profileContext = '', syllabusChapters = [] }) {
  // L: filter by selected subject FIRST, only then apply prompt-size limit — ensures later Class 10 subjects reach AI
  let chaptersForPrompt = (syllabusChapters || []).filter(Boolean);
  // If subject is specific, ensure filtering already happened upstream, but we still ensure we don't slice before filtering
  // For Mixed, we want to include diverse subjects, so sample across if large
  if (chaptersForPrompt.length > 40) {
    // If Mixed and large, take a diverse sample: first 20 + last 20 to include later subjects like SST, English
    if (!subject || subject === 'Mixed' || subject === 'All') {
      const first = chaptersForPrompt.slice(0, 20);
      const last = chaptersForPrompt.slice(-20);
      const combined = [...new Set([...first, ...last])];
      chaptersForPrompt = combined.slice(0, 40);
    } else {
      chaptersForPrompt = chaptersForPrompt.slice(0, 40);
    }
  }

  const chapterHint = chaptersForPrompt.length
    ? `Generate from these chapters of the student's OWN syllabus: ${chaptersForPrompt.map(esc).join('; ')}.`
    : '';

  const attempt = async (requestedCount) => {
    const data = await askAIJSON({
      prompt: `Create ${requestedCount} multiple-choice questions for an Indian student.
Subject: ${esc(subject) || 'General'}${topic ? ` · Topic: ${esc(topic)}` : ''}.
Difficulty: ${difficulty}. Mix conceptual + application questions.
${chapterHint}
${classGuard(profileContext)}
IMPORTANT: Return EXACTLY ${requestedCount} questions, no fewer. If you cannot make ${requestedCount}, return what you can but include a field \"incomplete\": true.
Return JSON: {"questions":[{"q":"...","options":["A","B","C","D"],"answer":0,"answer_text":"exact text of the correct option","explanation":"one line why","topic":"subtopic name","difficulty":1}]}. "answer" is the 0-based index of the correct option. Options must be plausible and unambiguous.`,
      system: AI_PERSONA,
      schemaHint: '{"questions":[{q, options[4], answer, explanation, topic, difficulty}]}',
      temperature: 0.5,
      noCache: true,
    });
    const qs = Array.isArray(data?.questions) ? data.questions : [];
    const clean = qs.map((q) => normalizeQuestionShape(q, subject || 'AI Quiz', topic || 'Mixed', difficulty === 'hard' ? 3 : 2)).filter(Boolean);
    return { clean, incomplete: data?.incomplete, rawCount: qs.length };
  };

  let result = await attempt(count);

  // D: If generation is incomplete, retry once for missing count
  if (result.clean.length < Math.ceil(count * 0.7) && result.clean.length > 0) {
    try {
      const missing = count - result.clean.length;
      const retry = await attempt(missing);
      result.clean = [...result.clean, ...retry.clean].slice(0, count);
    } catch {
      // keep existing
    }
  }

  if (!result.clean.length) throw new AIUnavailableError('AI ka quiz samajh nahi aaya — bank se laa raha hoon.');

  if (result.clean.length < Math.ceil(count * 0.5)) {
    throw new AIUnavailableError(`AI ne sirf ${result.clean.length}/${count} questions diye — thoda chhota count try karo ya dobara try karo.`);
  }

  return result.clean.slice(0, count);
}

// ---------- flashcard deck generation ----------
export async function aiGenerateFlashcards({ subject, topic, count = 8, profileContext = '' }) {
  const data = await askAIJSON({
    prompt: `Create ${count} flashcards for topic "${esc(topic)}\" of subject \"${esc(subject)}\" for an Indian student.
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
export async function aiChallengeQuestions({ profile = {}, syllabusRows = [], count = 5, topic = '' }) {
  const ctx = buildProfileContext(profile);
  // L: filter FIRST then limit — ensure later subjects included
  let chapters = syllabusRows.map((r) => r.chapter).filter(Boolean);
  if (chapters.length > 60) {
    const first = chapters.slice(0, 30);
    const last = chapters.slice(-30);
    chapters = [...new Set([...first, ...last])].slice(0, 60);
  }
  const data = await askAIJSON({
    prompt: `Create ${count} rapid-fire multiple-choice questions for a daily challenge in a study game.
${classGuard(ctx)}
${chapters.length ? `From the student's OWN syllabus chapters: ${chapters.map(esc).join('; ')}.` : ''}
${topic ? `Focus topic: ${esc(topic)}.` : ''}
Difficulty should suit their prep level. Mix quick-recall + application.
Return JSON: {"questions":[{"q":"...","options":["A","B","C","D"],"answer":0,"answer_text":"exact text of the correct option","explanation":"one line","topic":"chapter name","difficulty":2}]}`,
    system: AI_PERSONA,
    schemaHint: '{"questions":[{q, options[4], answer, explanation, topic, difficulty}]}',
    temperature: 0.6,
    noCache: true,
  });
  const qs = Array.isArray(data?.questions) ? data.questions : [];
  const clean = qs
    .map((q) => normalizeQuestionShape(q, 'Challenge', topic || 'Mixed', 2))
    .filter(Boolean)
    .map((q) => ({ ...q, source: 'ai' }));
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

// ============================================================
// AI TEST BUILDER (v1.0.2) — full tests (2 sets), question banks
// and per-chapter mind maps, with a strict JSON contract.
// v1.0.6 recovery: robust normalization, count validation, retry
// ============================================================
function normalizeTestQuestion(q) {
  if (!q) return null;
  const qText = q.q || q.question || q.text || '';
  if (!qText) return null;
  let options = [];
  if (Array.isArray(q.options)) options = q.options;
  else if (Array.isArray(q.choices)) options = q.choices;
  else if (q.options && typeof q.options === 'object') options = Object.values(q.options);
  else if (q.a && q.b) options = [q.a, q.b, q.c, q.d].filter(Boolean);

  options = options.map((o) => String(o).trim()).filter(Boolean);
  // v1.0.6 Y Round2: don't default typeless questions to MCQ — decide from evidence
  const declaredType = String(q.type || '').toLowerCase();
  const hasOptions = options.length >= 2;
  let isMCQ = declaredType.includes('mcq') || (!declaredType && hasOptions);

  // v1.0.6 Y Round2: never discard a question that has valid text — downgrade to written instead
  if (isMCQ && options.length < 2) {
    isMCQ = false;
  }
  if (isMCQ) {
    while (options.length < 4) options.push(`Option ${options.length + 1}`);
    options = options.slice(0, 4);
  }

  const answerIdx = isMCQ ? resolveAnswerIndex({ ...q, options }) : 0;
  const answerText = isMCQ ? options[answerIdx] : (q.answer || q.answer_text || '');

  // preserve declared type if present, else infer
  let finalType = declaredType || (isMCQ ? 'mcq' : 'saq');
  if (!['mcq','vsaq','saq','laq'].some(t => finalType.includes(t))) {
    finalType = isMCQ ? 'mcq' : 'saq';
  }

  return {
    q: String(qText).slice(0, 600),
    options: isMCQ ? options : [],
    answer: isMCQ ? answerIdx : String(answerText).slice(0, 300),
    answer_text: isMCQ ? String(answerText).slice(0, 300) : String(answerText).slice(0, 300),
    explanation: String(q.explanation || q.why || '').slice(0, 400),
    why: String(q.why || q.explanation || '').slice(0, 400),
    marks: q.marks || 1,
    type: finalType,
    topic: q.topic || '',
  };
}

export async function aiGenerateTest({ profile = {}, chapters = [], breakdown = {}, totalMarks = 80, totalQuestions = 30, difficultyPct = 100, timeMinutes = 180 }) {
  const ctx = buildProfileContext(profile);
  const chList = chapters.length ? chapters.map((c) => `${c.subject} — ${c.chapter}`).join('; ') : 'whole syllabus';
  const parts = [
    `MCQ: ${breakdown.mcq || 0} (1 mark each)`,
    `Very Short Answer (VSAQ): ${breakdown.vsaq || 0} (2 marks each)`,
    `Short Answer (SAQ): ${breakdown.saq || 0} (3 marks each)`,
    `Long Answer (LAQ): ${breakdown.laq || 0} (5 marks each)`,
  ].filter((p) => !p.match(/: 0 /)).join(', ');

  const attempt = async () => {
    const data = await askAIJSON({
      prompt: `Generate a complete school test as JSON for this student.
Student: ${esc(ctx)}.
Chapters to cover: ${esc(chList)}.
Test: ${totalMarks} marks, ${totalQuestions} questions, ${timeMinutes} minutes.
Question breakdown: ${parts || 'MCQs and short answers'}.
Difficulty: ${difficultyPct}% of the student's exam level (100% = board/exam level, 150% = competitive level, 200% = olympiad level).
Create TWO full sets (Set A and Set B) with DIFFERENT questions of the same pattern, like real exam papers.
Questions must be syllabus-accurate, in simple English, no markdown anywhere.
Math notation: plain text only (a/b, sqrt(x), x^2) — never LaTeX.
IMPORTANT: Return EXACTLY ${totalQuestions} questions per set, no fewer.`,
      system: `${AI_PERSONA}\nYou are a strict examiner. Output ONLY the JSON object.`,
      schemaHint: `{
  "sets": [
    { "set": "A", "sections": [
      { "type": "mcq", "label": "Section A — MCQ (1 mark each)", "questions": [ { "type": "mcq", "q": "text", "options": ["a","b","c","d"], "answer": "b", "marks": 1 } ] },
      { "type": "vsaq", "label": "Section B — VSAQ (2 marks each)", "questions": [ { "type": "vsaq", "q": "text", "answer": "model answer", "marks": 2 } ] },
      { "type": "saq", "label": "Section C — SAQ (3 marks each)", "questions": [ { "type": "saq", "q": "text", "answer": "model answer", "marks": 3 } ] },
      { "type": "laq", "label": "Section D — LAQ (5 marks each)", "questions": [ { "type": "laq", "q": "text", "answer": "model answer", "marks": 5 } ] }
    ] }
  ],
  "tips": "one line of exam tips"
}`,
      temperature: 0.5,
      noCache: true,
    });

    // Normalize sets — v1.0.6 Y Round2: filter empty sections, never render bare 'Section'
    if (Array.isArray(data?.sets)) {
      const labelForType = (type, idx) => {
        const t = String(type || '').toLowerCase();
        if (t.includes('mcq')) return `Section ${String.fromCharCode(65+idx)} — MCQ`;
        if (t.includes('vsaq')) return `Section ${String.fromCharCode(65+idx)} — VSAQ`;
        if (t.includes('saq')) return `Section ${String.fromCharCode(65+idx)} — SAQ`;
        if (t.includes('laq')) return `Section ${String.fromCharCode(65+idx)} — LAQ`;
        return `Section ${String.fromCharCode(65+idx)} — ${type || 'Questions'}`;
      };
      data.sets = data.sets.map((set) => {
        const rawSections = Array.isArray(set.sections) ? set.sections : [];
        const normalized = rawSections.map((sec, idx) => {
          const type = sec.type || sec.label || 'mcq';
          // never fallback to literal 'Section' alone
          const label = sec.label && sec.label.trim() !== 'Section' ? sec.label : (sec.type ? labelForType(sec.type, idx) : labelForType(type, idx));
          const questions = Array.isArray(sec.questions) ? sec.questions.map(normalizeTestQuestion).filter(Boolean) : [];
          return { type, label, questions };
        }).filter(s => s.questions && s.questions.length > 0); // v1.0.6 Y Round2: do not render empty sections
        return { set: set.set || 'A', sections: normalized };
      });
      // Count total questions
      const total = data.sets.reduce((a, s) => a + s.sections.reduce((aa, sec) => aa + (sec.questions?.length || 0), 0), 0);
      data._totalQuestions = total;
    }
    return data;
  };

  let data = await attempt();

  // If incomplete, retry once
  if (data?._totalQuestions && data._totalQuestions < totalQuestions) {
    try {
      const retry = await attempt();
      if (retry._totalQuestions > data._totalQuestions) data = retry;
    } catch {}
  }

  if (!data?.sets?.length) throw new Error('AI ne khaali paper bheja — thoda chhota try karo.');

  const totalQs = data.sets.reduce((a, s) => a + s.sections.reduce((aa, sec) => aa + (sec.questions?.length || 0), 0), 0);
  if (totalQs < Math.ceil(totalQuestions * 0.5)) {
    throw new AIUnavailableError(`AI ne sirf ${totalQs}/${totalQuestions} questions diye — chhota count try karo ya dobara try karo.`);
  }

  return data;
}

export async function aiGenerateQuestionBank({ profile = {}, chapters = [], breakdown = {}, totalQuestions = 25, difficultyPct = 100 }) {
  const ctx = buildProfileContext(profile);
  const chList = chapters.length ? chapters.map((c) => `${c.subject} — ${c.chapter}`).join('; ') : 'whole syllabus';

  const attempt = async (reqCount) => {
    const data = await askAIJSON({
      prompt: `Generate a practice QUESTION BANK as JSON for this student.
Student: ${esc(ctx)}.
Chapters: ${esc(chList)}.
Total questions: ${reqCount}. Mix: MCQ ${breakdown.mcq || 0}, VSAQ ${breakdown.vsaq || 0}, SAQ ${breakdown.saq || 0}, LAQ ${breakdown.laq || 0}.
Difficulty: ${difficultyPct}% of their exam level. No time limit, no marks total — just practice questions with answers.
Simple English, no markdown. Math in plain text only.
IMPORTANT: Return EXACTLY ${reqCount} questions, no fewer.`,
      system: `${AI_PERSONA}\nYou are a question-bank generator. Output ONLY the JSON object.`,
      schemaHint: `{
  "questions": [ { "type": "mcq", "q": "text", "options": ["a","b","c","d"], "answer": "b", "why": "one-line reason" },
                 { "type": "saq", "q": "text", "answer": "model answer" } ],
  "weakSpots": "one line on what to revise"
}`,
      temperature: 0.5,
      noCache: true,
    });

    const qs = Array.isArray(data?.questions) ? data.questions : [];
    const clean = qs.map((q) => normalizeTestQuestion(q)).filter(Boolean);
    return { data: { ...data, questions: clean }, count: clean.length };
  };

  let result = await attempt(totalQuestions);

  if (result.count < Math.ceil(totalQuestions * 0.7) && result.count > 0) {
    try {
      const retry = await attempt(totalQuestions - result.count);
      result.data.questions = [...result.data.questions, ...retry.data.questions].slice(0, totalQuestions);
      result.count = result.data.questions.length;
    } catch {}
  }

  if (!result.data?.questions?.length) throw new Error('AI ne khaali bank bheja — dobara try karo.');

  if (result.count < Math.ceil(totalQuestions * 0.5)) {
    throw new AIUnavailableError(`AI ne sirf ${result.count}/${totalQuestions} questions diye — chhota count try karo ya dobara try karo.`);
  }

  return result.data;
}

function normalizeMindMapResponse(data, fallbackChapters) {
  if (!data) return { chapters: [] };
  let chapters = data.chapters || data.maps || data.mindMaps || data.mind_maps || [];
  if (!Array.isArray(chapters)) chapters = [];
  const clean = chapters.map((c, idx) => {
    const chapterName = c.chapter || c.title || c.name || fallbackChapters[idx]?.chapter || `Chapter ${idx+1}`;
    let root = c.root || c.map || c.mindmap || c.central || null;
    // Alternate shapes: if root is string, wrap; if c has branches directly, build root
    if (!root) {
      if (Array.isArray(c.branches)) {
        root = { label: c.central || chapterName, children: c.branches.map(b => typeof b === 'string' ? { label: b } : { label: b.label || b.name || 'Branch', children: (b.points || b.children || []).map(p => typeof p === 'string' ? { label: p } : { label: p.label || String(p) }) }) };
      } else if (Array.isArray(c.points)) {
        root = { label: chapterName, children: c.points.map(p => typeof p === 'string' ? { label: p } : { label: p.label || String(p) }) };
      } else if (typeof c === 'object' && c.label) {
        root = c;
      }
    }
    if (typeof root === 'string') root = { label: root, children: [] };
    if (!root || !root.label) return null;
    // ensure children are objects with label
    const normalizeNode = (n) => {
      if (typeof n === 'string') return { label: n, children: [] };
      if (!n || typeof n !== 'object') return null;
      const label = n.label || n.name || n.text || n.title || '';
      if (!label) return null;
      const children = Array.isArray(n.children) ? n.children.map(normalizeNode).filter(Boolean) : Array.isArray(n.points) ? n.points.map(normalizeNode).filter(Boolean) : [];
      return { label: String(label).slice(0, 120), children };
    };
    const normRoot = normalizeNode(root);
    if (!normRoot) return null;
    return { chapter: String(chapterName).slice(0, 120), root: normRoot };
  }).filter(Boolean);
  return { chapters: clean };
}

export async function aiGenerateMindMap({ profile = {}, chapters = [] }) {
  const ctx = buildProfileContext(profile);
  const chList = chapters.length ? chapters.map((c) => `${c.subject} — ${c.chapter}`).join('; ') : 'whole syllabus';
  const raw = await askAIJSON({
    prompt: `Create a one-page revision MIND MAP as JSON for each of these chapters: ${esc(chList)}.
Student: ${esc(ctx)}.
For each chapter: a central idea with 4-6 main branches, each branch with 2-4 leaf points. Short phrases only (3-7 words), the kind a topper writes on one page. No markdown anywhere.`,
    system: `${AI_PERSONA}\nYou are a revision-notes expert. Output ONLY the JSON object.`,
    schemaHint: `{
  "chapters": [
    { "chapter": "chapter name", "root": { "label": "central idea",
      "children": [ { "label": "branch", "children": [ { "label": "leaf" } ] } ] } }
  ]
}`,
    temperature: 0.4,
    noCache: true,
  });
  const normalized = normalizeMindMapResponse(raw, chapters);
  if (!normalized.chapters.length) {
    // if AI returned empty, throw readable error so UI shows reason, not generic
    throw new Error(raw?.chapters ? 'Mind map shape samajh nahi aaya — dobara try karo' : 'Mind map nahi bana — dobara try karo');
  }
  return normalized;
}
