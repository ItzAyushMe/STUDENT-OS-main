// ============================================================
// StudentOS — Free Study Library (pre-loaded, zero setup)
// Curated FREE resources every student gets by default.
//
// Links are deliberately CHANNEL/SITE level or YouTube SEARCH urls —
// they never rot like individual video links. All content is free;
// students add their own notes/links on top in the Content Locker.
// ============================================================

// YouTube search links — always resolve to fresh, relevant results
const yt = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

export const FREE_LIBRARY = {
  general: [
    {
      title: 'NCERT Textbooks — every class, free PDFs',
      kind: 'notes',
      url: 'https://ncert.nic.in/textbook.php',
      source: 'NCERT (official)',
      desc: 'The source of truth for CBSE + JEE/NEET basics. Raat ki light on, official books free.',
    },
    {
      title: 'NCERT Solutions + Exemplar problems',
      kind: 'practice',
      url: 'https://ncert.nic.in/exemplar-problems.php',
      source: 'NCERT (official)',
      desc: 'Exemplar = the smartest question bank for boards and beyond.',
    },
    {
      title: 'Khan Academy — free courses (Maths & Science)',
      kind: 'video',
      url: 'https://www.khanacademy.org',
      source: 'Khan Academy',
      desc: 'Concept video se practice tak, free forever. Hindi mein bhi available.',
    },
    {
      title: 'Khan Academy Hindi (YouTube)',
      kind: 'video',
      url: 'https://www.youtube.com/@KhanAcademyHindi',
      source: 'Khan Academy Hindi',
      desc: 'Same world-class explanations, Hindi mein.',
    },
    {
      title: 'CBSE sample papers & PYQs',
      kind: 'pyq',
      url: 'https://cbseacademic.nic.in/SQP_CLASSXII_2025-26.html',
      source: 'CBSE (official)',
      desc: 'Board exam ke asli sample papers — timing ke saath solve karo.',
    },
    {
      title: 'NTA — JEE Main / NEET official PYQs',
      kind: 'pyq',
      url: 'https://nta.ac.in',
      source: 'NTA (official)',
      desc: 'Previous year papers + answer keys, straight from the source.',
    },
    {
      title: 'Doubtnut — photo le, solution pao',
      kind: 'practice',
      url: 'https://www.doubtnut.com',
      source: 'Doubtnut',
      desc: 'Stuck on a question? Snapshot karo — video solution mil jayega.',
    },
  ],

  subjects: {
    Physics: [
      { chapter: 'Kinematics (Class 11)', items: [
        { title: 'One-shot: Kinematics', kind: 'video', url: yt('kinematics class 11 one shot'), source: 'YouTube search' },
        { title: 'Notes + solved problems', kind: 'notes', url: 'https://ncert.nic.in/textbook.php', source: 'NCERT' },
      ]},
      { chapter: 'Laws of Motion (Class 11)', items: [
        { title: 'One-shot: Newton\'s Laws + FBD', kind: 'video', url: yt('laws of motion class 11 one shot'), source: 'YouTube search' },
        { title: 'Practice: friction problems', kind: 'practice', url: yt('laws of motion class 11 jee questions'), source: 'YouTube search' },
      ]},
      { chapter: 'Electrostatics (Class 12)', items: [
        { title: 'One-shot: Electrostatics', kind: 'video', url: yt('electrostatics class 12 one shot'), source: 'YouTube search' },
        { title: 'PYQs: Electrostatics JEE Main', kind: 'pyq', url: yt('electrostatics jee main previous year questions'), source: 'YouTube search' },
      ]},
      { chapter: 'Current Electricity (Class 12)', items: [
        { title: 'One-shot: Current Electricity', kind: 'video', url: yt('current electricity class 12 one shot'), source: 'YouTube search' },
        { title: 'Board revision: important questions', kind: 'practice', url: yt('current electricity class 12 board important questions'), source: 'YouTube search' },
      ]},
      { chapter: 'Light — Reflection & Refraction (Class 10)', items: [
        { title: 'One-shot: Light (Class 10)', kind: 'video', url: yt('light reflection refraction class 10 one shot'), source: 'YouTube search' },
        { title: 'Ray diagram practice sheet', kind: 'practice', url: yt('light class 10 numericals practice'), source: 'YouTube search' },
      ]},
    ],
    Chemistry: [
      { chapter: 'Chemical Bonding (Class 11)', items: [
        { title: 'One-shot: Chemical Bonding', kind: 'video', url: yt('chemical bonding class 11 one shot'), source: 'YouTube search' },
        { title: 'PYQs: Bonding JEE/NEET', kind: 'pyq', url: yt('chemical bonding jee neet previous year questions'), source: 'YouTube search' },
      ]},
      { chapter: 'Organic Chemistry — GOC basics (Class 11)', items: [
        { title: 'One-shot: GOC', kind: 'video', url: yt('general organic chemistry one shot class 11'), source: 'YouTube search' },
        { title: 'Named reactions rapid revision', kind: 'notes', url: yt('named reactions organic chemistry revision'), source: 'YouTube search' },
      ]},
      { chapter: 'Electrochemistry (Class 12)', items: [
        { title: 'One-shot: Electrochemistry', kind: 'video', url: yt('electrochemistry class 12 one shot'), source: 'YouTube search' },
        { title: 'Numericals practice', kind: 'practice', url: yt('electrochemistry class 12 numericals'), source: 'YouTube search' },
      ]},
      { chapter: 'Carbon and its Compounds (Class 10)', items: [
        { title: 'One-shot: Carbon & compounds', kind: 'video', url: yt('carbon and its compounds class 10 one shot'), source: 'YouTube search' },
      ]},
    ],
    Maths: [
      { chapter: 'Trigonometry (Class 10)', items: [
        { title: 'One-shot: Introduction to Trigonometry', kind: 'video', url: yt('trigonometry class 10 one shot'), source: 'YouTube search' },
        { title: 'Identities practice set', kind: 'practice', url: yt('trigonometry class 10 important questions'), source: 'YouTube search' },
      ]},
      { chapter: 'Quadratic Equations (Class 10)', items: [
        { title: 'One-shot: Quadratics', kind: 'video', url: yt('quadratic equations class 10 one shot'), source: 'YouTube search' },
      ]},
      { chapter: 'Calculus — Limits & Derivatives (Class 11/12)', items: [
        { title: 'One-shot: Limits', kind: 'video', url: yt('limits class 11 one shot'), source: 'YouTube search' },
        { title: 'One-shot: Derivatives', kind: 'video', url: yt('derivatives class 12 one shot'), source: 'YouTube search' },
        { title: 'Integration one-shot', kind: 'video', url: yt('integrals class 12 one shot'), source: 'YouTube search' },
      ]},
      { chapter: 'Probability & Statistics', items: [
        { title: 'One-shot: Probability', kind: 'video', url: yt('probability class 12 one shot'), source: 'YouTube search' },
      ]},
    ],
    Biology: [
      { chapter: 'Cell — The Unit of Life (Class 11)', items: [
        { title: 'One-shot: Cell structure', kind: 'video', url: yt('cell the unit of life class 11 one shot'), source: 'YouTube search' },
      ]},
      { chapter: 'Life Processes (Class 10)', items: [
        { title: 'One-shot: Life Processes', kind: 'video', url: yt('life processes class 10 one shot'), source: 'YouTube search' },
        { title: 'Diagram practice (NCERT)', kind: 'notes', url: 'https://ncert.nic.in/textbook.php', source: 'NCERT' },
      ]},
      { chapter: 'Genetics & Evolution (Class 12)', items: [
        { title: 'One-shot: Genetics', kind: 'video', url: yt('genetics class 12 one shot'), source: 'YouTube search' },
        { title: 'NEET PYQs: Genetics', kind: 'pyq', url: yt('genetics neet previous year questions'), source: 'YouTube search' },
      ]},
    ],
    'Science (Class 6–8)': [
      { chapter: 'Every chapter, explained simply', items: [
        { title: 'Class 6 Science — full playlist search', kind: 'video', url: yt('class 6 science ncert full course'), source: 'YouTube search' },
        { title: 'Class 8 Science — full playlist search', kind: 'video', url: yt('class 8 science ncert full course'), source: 'YouTube search' },
      ]},
    ],
  },

  // Olympiad sub-library — IOQM / INMO / NSO / NSEP tracks
  olympiad: [
    {
      title: 'HBCSE Olympiads (official) — IOQM/INMO/INPhO/INChO',
      kind: 'notes',
      url: 'https://olympiads.hbcse.tifr.res.in',
      source: 'HBCSE (official)',
      desc: 'Syllabus, past papers, eligibility — the official home of Indian olympiads.',
    },
    {
      title: 'IOQM past papers + solutions',
      kind: 'pyq',
      url: 'https://olympiads.hbcse.tifr.res.in/mathematical-olympiad/previous-question-papers-and-solutions/',
      source: 'HBCSE (official)',
      desc: 'Best IOQM prep = solving actual IOQM/RMO/PRMO papers.',
    },
    {
      title: 'Art of Problem Solving — the olympiad community',
      kind: 'practice',
      url: 'https://artofproblemsolving.com',
      source: 'AoPS',
      desc: 'Worldwide hub for olympiad problems, solutions and techniques.',
    },
    {
      title: 'Number Theory lectures (olympiad level)',
      kind: 'video',
      url: yt('number theory olympiad lectures'),
      source: 'YouTube search',
      desc: 'Divisibility, mod arithmetic — IOQM ka core.',
    },
    {
      title: 'Geometry for olympiads — angle chasing',
      kind: 'video',
      url: yt('olympiad geometry angle chasing'),
      source: 'YouTube search',
      desc: 'Where every maths olympiad journey starts.',
    },
    {
      title: 'SOF — IMO / NSO official site',
      kind: 'notes',
      url: 'https://sofworld.org',
      source: 'SOF (official)',
      desc: 'Syllabus + sample papers for school-level olympiads (IMO, NSO, IEO).',
    },
    {
      title: 'NSEP / NSEC past papers (Physics/Chemistry olympiads)',
      kind: 'pyq',
      url: 'https://olympiads.hbcse.tifr.res.in/previous-papers/',
      source: 'HBCSE (official)',
      desc: 'For the NSEP/NSEC tracks in your Olympiad syllabus.',
    },
  ],
};

export const LIB_KIND_ICON = {
  video: '🎬',
  notes: '📝',
  practice: '🎯',
  pyq: '📊',
  link: '🔗',
};
