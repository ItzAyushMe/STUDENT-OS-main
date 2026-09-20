
// NEW X R5: pure test question normalizer — no react-native deps
function resolveAnswerIndex(q) {
  const options = Array.isArray(q.options) ? q.options.map(String) : [];
  const at = String(q.answer_text ?? q.answerText ?? q.answer ?? '').trim();
  const letterMatch = at.toLowerCase().match(/^[a-d]$/);
  if (letterMatch) {
    return letterMatch[0].charCodeAt(0) - 97;
  }
  if (at) {
    const i = options.findIndex(
      (o) => o.trim().toLowerCase() === at.toLowerCase() || o.trim().toLowerCase().startsWith(at.toLowerCase()) || at.toLowerCase().startsWith(o.trim().toLowerCase())
    );
    if (i >= 0) return i;
  }
  const n = Number(q.answer);
  if (Number.isInteger(n) && n >= 0 && n < options.length) return n;
  if (Number.isInteger(n) && n >= 1 && n <= options.length) return n - 1;
  if (typeof q.answer === 'string') {
    const l = q.answer.trim().toLowerCase();
    if (l.length === 1 && l >= 'a' && l <= 'd') return l.charCodeAt(0) - 97;
  }
  return 0;
}

function resolveAnswerIndexStrict({ answer, options }) {
  const opts = Array.isArray(options) ? options.map(String) : [];
  const at = String(answer ?? '').trim();
  if (!at) return null;
  const letter = at.toLowerCase().match(/^[a-d]$/);
  if (letter) {
    const idx = letter[0].charCodeAt(0) - 97;
    if (idx >=0 && idx < opts.length) return idx;
    return null;
  }
  const lowerAt = at.toLowerCase();
  let idx = opts.findIndex(o => o.trim().toLowerCase() === lowerAt);
  if (idx >=0) return idx;
  idx = opts.findIndex(o => o.trim().toLowerCase().startsWith(lowerAt) || lowerAt.startsWith(o.trim().toLowerCase()));
  if (idx >=0) return idx;
  const n = Number(at);
  if (Number.isInteger(n) && n >=0 && n < opts.length) return n;
  if (Number.isInteger(n) && n >=1 && n <= opts.length) return n-1;
  return null;
}

export function normalizeTestQuestion(q, fallbackType = 'saq') {
  if (!q) return null;
  if (typeof q === 'string') {
    const txt = q.trim();
    if (txt.length < 3) return null;
    const ft = String(fallbackType || 'saq').toLowerCase();
    return {
      q: txt.slice(0, 600),
      options: [],
      answer: txt.slice(0, 300),
      answer_text: txt.slice(0, 300),
      explanation: '',
      why: '',
      marks: ft.includes('vsaq') ? 2 : ft.includes('saq') ? 3 : ft.includes('laq') ? 5 : 1,
      type: ft,
      topic: '',
    };
  }
  const qText = q.q || q.question || q.text || q.prompt || q.title || '';
  if (!qText || typeof qText !== 'string' || qText.trim().length < 3) return null;

  let options = [];
  if (Array.isArray(q.options)) options = q.options;
  else if (Array.isArray(q.choices)) options = q.choices;
  else if (q.options && typeof q.options === 'object') options = Object.values(q.options);
  else if (q.a && q.b) options = [q.a, q.b, q.c, q.d].filter(Boolean);
  options = options.map((o) => String(o).trim()).filter(Boolean);

  const hasExplicitType = Boolean(q.type);
  const declaredType = String(q.type || '').toLowerCase();
  const hasOptions = options.length >= 2;
  let isMCQ = declaredType.includes('mcq') || (!hasExplicitType && hasOptions);
  if (isMCQ && options.length < 2) isMCQ = false;
  if (isMCQ) {
    options = options.slice(0, 4);
  }

  let rawAnswer = q.answer;
  if (rawAnswer === undefined || rawAnswer === null || rawAnswer === '') {
    rawAnswer = q.answer_text;
  }
  if (rawAnswer === undefined || rawAnswer === null || rawAnswer === '') {
    rawAnswer = q.ans;
  }
  if (rawAnswer === undefined || rawAnswer === null || rawAnswer === '') {
    rawAnswer = q.solution;
  }
  if (rawAnswer === undefined || rawAnswer === null || rawAnswer === '') {
    rawAnswer = q.model_answer;
  }

  let answerIdx = null;
  let answerText = '';
  if (isMCQ) {
    if (rawAnswer !== undefined && rawAnswer !== null && rawAnswer !== '') {
      const resolved = resolveAnswerIndexStrict({ answer: rawAnswer, options });
      if (resolved === null) {
        answerIdx = null;
        answerText = String(rawAnswer).slice(0, 300);
      } else {
        answerIdx = resolved;
        answerText = options[answerIdx] || String(rawAnswer).slice(0, 300);
      }
    } else {
      answerIdx = null;
      answerText = '';
    }
  } else {
    answerText = String(rawAnswer || '').slice(0, 600);
  }

  let finalType = declaredType || (isMCQ ? 'mcq' : (fallbackType || 'saq'));
  if (!['mcq','vsaq','saq','laq'].some(t => finalType.includes(t))) {
    finalType = isMCQ ? 'mcq' : (fallbackType || 'saq');
  }

  return {
    q: String(qText).slice(0, 600),
    options: isMCQ ? options : [],
    answer: isMCQ ? answerIdx : answerText,
    answer_text: answerText,
    explanation: String(q.explanation || q.why || q.reason || '').slice(0, 400),
    why: String(q.why || q.explanation || '').slice(0, 400),
    marks: q.marks || (finalType.includes('vsaq') ? 2 : finalType.includes('saq') ? 3 : finalType.includes('laq') ? 5 : 1),
    type: finalType,
    topic: q.topic || '',
  };
}

export { resolveAnswerIndex, resolveAnswerIndexStrict };
