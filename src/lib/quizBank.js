// ============================================================
// StudentOS — bundled question bank
// Powers quizzes / Daily Arena / battles fully OFFLINE. The Daily
// Arena set is date-seeded, so every player gets the same 5
// questions on the same day. AI (Layer 4) adds custom questions
// on top of this bank.
// ============================================================
import { seededShuffle, hashString } from './utils';

export const QUIZ_BANK = [
  { subject: 'Maths', topic: 'Algebra', difficulty: 1, q: 'If x + 5 = 12, what is x?', options: ['5', '7', '6', '17'], answer: 1, explanation: 'x = 12 − 5 = 7.' },
  { subject: 'Maths', topic: 'Algebra', difficulty: 1, q: 'Solve: 3x = 21', options: ['x = 6', 'x = 7', 'x = 8', 'x = 9'], answer: 1, explanation: 'x = 21/3 = 7.' },
  { subject: 'Maths', topic: 'Percentages', difficulty: 1, q: 'What is 15% of 200?', options: ['25', '30', '35', '40'], answer: 1, explanation: '0.15 × 200 = 30.' },
  { subject: 'Maths', topic: 'Percentages', difficulty: 2, q: 'A shirt costs ₹800 after a 20% discount. What was the original price?', options: ['₹950', '₹1000', '₹1040', '₹960'], answer: 1, explanation: '800 = 80% of original → original = 1000.' },
  { subject: 'Maths', topic: 'Geometry', difficulty: 1, q: 'Sum of interior angles of a triangle?', options: ['90°', '180°', '270°', '360°'], answer: 1, explanation: 'Always 180°.' },
  { subject: 'Maths', topic: 'Geometry', difficulty: 2, q: 'Area of a circle with radius 7 cm? (π = 22/7)', options: ['154 cm²', '144 cm²', '44 cm²', '168 cm²'], answer: 0, explanation: 'πr² = 22/7 × 49 = 154 cm².' },
  { subject: 'Maths', topic: 'Number Theory', difficulty: 2, q: 'Which of these is a prime number?', options: ['91', '87', '97', '93'], answer: 2, explanation: '97 has no divisors other than 1 and itself.' },
  { subject: 'Maths', topic: 'Arithmetic', difficulty: 2, q: 'The LCM of 12 and 18 is:', options: ['36', '54', '72', '24'], answer: 0, explanation: '12 = 2²×3, 18 = 2×3² → LCM = 2²×3² = 36.' },
  { subject: 'Maths', topic: 'Trigonometry', difficulty: 2, q: 'sin 30° equals:', options: ['1/2', '√3/2', '1', '0'], answer: 0, explanation: 'sin 30° = 1/2.' },
  { subject: 'Maths', topic: 'Probability', difficulty: 1, q: 'Probability of getting a head in one coin toss?', options: ['0', '1/4', '1/2', '1'], answer: 2, explanation: 'One head out of two outcomes → 1/2.' },
  { subject: 'Maths', topic: 'Sequences', difficulty: 2, q: 'Next number: 2, 6, 12, 20, 30, …?', options: ['40', '42', '36', '44'], answer: 1, explanation: 'Differences are 4, 6, 8, 10, 12 → 30 + 12 = 42.' },
  { subject: 'Maths', topic: 'Logic', difficulty: 3, q: 'If ALL bloops are razzies and some razzies are lazzies, which MUST be true?', options: ['All bloops are lazzies', 'Some bloops are lazzies', 'No bloop is a lazzie', 'None of these must be true'], answer: 3, explanation: 'The overlap of razzies-lazzies may not include any bloop.' },

  { subject: 'Physics', topic: 'Motion', difficulty: 1, q: 'SI unit of speed is:', options: ['km/h', 'm/s', 'm/s²', 'N'], answer: 1, explanation: 'Metre per second (m/s).' },
  { subject: 'Physics', topic: 'Motion', difficulty: 2, q: 'A body moves 100 m in 20 s at constant speed. Its speed is:', options: ['2 m/s', '5 m/s', '10 m/s', '20 m/s'], answer: 1, explanation: '100/20 = 5 m/s.' },
  { subject: 'Physics', topic: 'Laws of Motion', difficulty: 2, q: "Newton's second law states F = ?", options: ['m/a', 'ma', 'm + a', 'm − a'], answer: 1, explanation: 'Force = mass × acceleration.' },
  { subject: 'Physics', topic: 'Energy', difficulty: 1, q: 'Kinetic energy of a body is given by:', options: ['mgh', '½mv²', 'mv', '½mv'], answer: 1, explanation: 'KE = ½ × mass × velocity².' },
  { subject: 'Physics', topic: 'Electricity', difficulty: 2, q: "Ohm's law: V = ?", options: ['I/R', 'R/I', 'IR', 'I + R'], answer: 2, explanation: 'Voltage = current × resistance.' },
  { subject: 'Physics', topic: 'Optics', difficulty: 2, q: 'Light bends when passing from air to water. This is called:', options: ['Reflection', 'Refraction', 'Diffraction', 'Dispersion'], answer: 1, explanation: 'Refraction — change of direction due to change in speed.' },
  { subject: 'Physics', topic: 'Units', difficulty: 1, q: 'Which quantity is measured in watts?', options: ['Force', 'Power', 'Energy', 'Pressure'], answer: 1, explanation: 'Power = 1 joule/second = 1 watt.' },
  { subject: 'Physics', topic: 'Gravitation', difficulty: 2, q: 'The value of g on Earth’s surface is about:', options: ['6.67 m/s²', '9.8 m/s²', '10.8 m/s²', '8.9 m/s²'], answer: 1, explanation: '≈ 9.8 m/s².' },

  { subject: 'Chemistry', topic: 'Periodic Table', difficulty: 1, q: 'Chemical symbol of sodium is:', options: ['So', 'Sd', 'Na', 'N'], answer: 2, explanation: 'From Latin ‘natrium’.' },
  { subject: 'Chemistry', topic: 'Periodic Table', difficulty: 2, q: 'Which element is a noble gas?', options: ['Nitrogen', 'Neon', 'Nickel', 'Neptunium'], answer: 1, explanation: 'Neon is in Group 18.' },
  { subject: 'Chemistry', topic: 'Acids & Bases', difficulty: 1, q: 'pH of a neutral solution at 25°C is:', options: ['0', '7', '10', '14'], answer: 1, explanation: 'pH 7 is neutral.' },
  { subject: 'Chemistry', topic: 'Acids & Bases', difficulty: 2, q: 'Which acid is present in the human stomach?', options: ['Sulphuric acid', 'Hydrochloric acid', 'Nitric acid', 'Acetic acid'], answer: 1, explanation: 'HCl (gastric acid).' },
  { subject: 'Chemistry', topic: 'Mole Concept', difficulty: 2, q: 'Molar mass of CO₂ (C = 12, O = 16):', options: ['28 g/mol', '44 g/mol', '32 g/mol', '48 g/mol'], answer: 1, explanation: '12 + 2×16 = 44 g/mol.' },
  { subject: 'Chemistry', topic: 'Bonding', difficulty: 2, q: 'NaCl is held together by:', options: ['Covalent bond', 'Ionic bond', 'Metallic bond', 'Hydrogen bond'], answer: 1, explanation: 'Electron transfer from Na to Cl → ionic bond.' },

  { subject: 'Biology', topic: 'Cell', difficulty: 1, q: 'The powerhouse of the cell is:', options: ['Nucleus', 'Ribosome', 'Mitochondria', 'Golgi body'], answer: 2, explanation: 'Mitochondria produce ATP.' },
  { subject: 'Biology', topic: 'Cell', difficulty: 2, q: 'Which organelle is absent in prokaryotic cells?', options: ['Cell membrane', 'Ribosome', 'Nucleus', 'Cytoplasm'], answer: 2, explanation: 'Prokaryotes lack a true membrane-bound nucleus.' },
  { subject: 'Biology', topic: 'Photosynthesis', difficulty: 1, q: 'Plants make food by the process of:', options: ['Respiration', 'Photosynthesis', 'Transpiration', 'Digestion'], answer: 1, explanation: 'CO₂ + H₂O + light → glucose + O₂.' },
  { subject: 'Biology', topic: 'Human Body', difficulty: 2, q: 'The largest human organ is:', options: ['Liver', 'Brain', 'Skin', 'Lungs'], answer: 2, explanation: 'Skin is the largest organ.' },
  { subject: 'Biology', topic: 'Genetics', difficulty: 2, q: 'How many chromosomes are in a normal human cell?', options: ['23', '44', '46', '48'], answer: 2, explanation: '23 pairs = 46 chromosomes.' },
  { subject: 'Biology', topic: 'Ecology', difficulty: 1, q: 'Which gas do plants absorb for photosynthesis?', options: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Hydrogen'], answer: 1, explanation: 'CO₂ is taken in through stomata.' },

  { subject: 'History', topic: 'Modern India', difficulty: 1, q: 'Who is called the Father of the Nation in India?', options: ['Jawaharlal Nehru', 'Mahatma Gandhi', 'Sardar Patel', 'Bhagat Singh'], answer: 1, explanation: 'Mahatma Gandhi.' },
  { subject: 'History', topic: 'Modern India', difficulty: 2, q: 'The Quit India Movement started in:', options: ['1930', '1942', '1947', '1919'], answer: 1, explanation: 'August 1942 — “Quit India”.' },
  { subject: 'History', topic: 'Ancient India', difficulty: 2, q: 'The Indus Valley Civilisation is also known as:', options: ['Vedic civilisation', 'Harappan civilisation', 'Mauryan empire', 'Gupta empire'], answer: 1, explanation: 'Named after Harappa, its first excavated site.' },
  { subject: 'History', topic: 'World', difficulty: 1, q: 'The first human to walk on the Moon was:', options: ['Yuri Gagarin', 'Buzz Aldrin', 'Neil Armstrong', 'Michael Collins'], answer: 2, explanation: 'Neil Armstrong, Apollo 11, 1969.' },

  { subject: 'Geography', topic: 'India', difficulty: 1, q: 'The capital of India is:', options: ['Mumbai', 'New Delhi', 'Kolkata', 'Chennai'], answer: 1, explanation: 'New Delhi.' },
  { subject: 'Geography', topic: 'India', difficulty: 2, q: 'Which is the longest river in India?', options: ['Yamuna', 'Godavari', 'Ganga', 'Narmada'], answer: 2, explanation: 'The Ganga (~2,525 km).' },
  { subject: 'Geography', topic: 'World', difficulty: 2, q: 'The largest ocean on Earth is the:', options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], answer: 3, explanation: 'The Pacific Ocean.' },
  { subject: 'Geography', topic: 'India', difficulty: 2, q: 'Kanchenjunga is located in which state?', options: ['Himachal Pradesh', 'Sikkim', 'Uttarakhand', 'Arunachal Pradesh'], answer: 1, explanation: 'Sikkim.' },

  { subject: 'Logic', topic: 'Aptitude', difficulty: 1, q: 'Complete: A, C, E, G, …?', options: ['H', 'I', 'J', 'K'], answer: 1, explanation: 'Skipping one letter each time → I.' },
  { subject: 'Logic', topic: 'Aptitude', difficulty: 2, q: 'If CAT = 3, DOG = 3, then ELEPHANT = ?', options: ['6', '7', '8', '9'], answer: 2, explanation: 'Number of letters — ELEPHANT has 8.' },
  { subject: 'Logic', topic: 'Aptitude', difficulty: 2, q: 'Find the odd one out:', options: ['Square', 'Rectangle', 'Triangle', 'Cube'], answer: 3, explanation: 'Cube is 3-D; the rest are 2-D shapes.' },
  { subject: 'Logic', topic: 'Aptitude', difficulty: 3, q: 'A clock shows 3:15. The angle between the hands is:', options: ['0°', '7.5°', '15°', '30°'], answer: 1, explanation: 'Hour hand: 97.5°; minute hand: 90° → 7.5°.' },
  { subject: 'Logic', topic: 'Aptitude', difficulty: 2, q: 'If 5 machines make 5 widgets in 5 minutes, how long do 100 machines take to make 100 widgets?', options: ['100 min', '20 min', '5 min', '1 min'], answer: 2, explanation: 'Each machine makes 1 widget in 5 min — so 5 minutes.' },

  { subject: 'English', topic: 'Grammar', difficulty: 1, q: 'Choose the correct spelling:', options: ['Recieve', 'Receive', 'Receeve', 'Receve'], answer: 1, explanation: '“i before e except after c” → receive.' },
  { subject: 'English', topic: 'Grammar', difficulty: 2, q: 'Identify the adverb: “She sings beautifully.”', options: ['She', 'sings', 'beautifully', 'None'], answer: 2, explanation: 'Beautifully modifies the verb sings.' },
  { subject: 'English', topic: 'Vocabulary', difficulty: 2, q: '“Diligent” means:', options: ['Lazy', 'Hardworking', 'Angry', 'Rude'], answer: 1, explanation: 'Diligent = careful and hardworking.' },
  { subject: 'English', topic: 'Vocabulary', difficulty: 3, q: 'A synonym for “perseverance” is:', options: ['Persistence', 'Perfection', 'Prestige', 'Passivity'], answer: 0, explanation: 'Perseverance = persistent effort.' },

  { subject: 'GK', topic: 'India', difficulty: 1, q: 'The national animal of India is:', options: ['Lion', 'Elephant', 'Tiger', 'Peacock'], answer: 2, explanation: 'Bengal Tiger.' },
  { subject: 'GK', topic: 'India', difficulty: 2, q: 'ISRO’s headquarters is in:', options: ['Bengaluru', 'Chennai', 'Hyderabad', 'Thiruvananthapuram'], answer: 0, explanation: 'Bengaluru, Karnataka.' },
  { subject: 'GK', topic: 'Science', difficulty: 1, q: 'How many planets are in our solar system?', options: ['7', '8', '9', '10'], answer: 1, explanation: 'Eight (Pluto was reclassified in 2006).' },
  { subject: 'GK', topic: 'Technology', difficulty: 2, q: 'What does “CPU” stand for?', options: ['Central Print Unit', 'Central Processing Unit', 'Computer Personal Unit', 'Central Power Unit'], answer: 1, explanation: 'Central Processing Unit.' },
  { subject: 'GK', topic: 'India', difficulty: 2, q: 'The Rupee symbol (₹) was adopted in:', options: ['2006', '2010', '2014', '1999'], answer: 1, explanation: '2010, designed by D. Udaya Kumar.' },
  { subject: 'GK', topic: 'Sports', difficulty: 1, q: 'How many players are on a cricket team on the field?', options: ['9', '10', '11', '12'], answer: 2, explanation: 'Eleven players.' },
];

// Same 5 questions for everyone on a given date (deterministic seed)
export function pickDailyArena(dateStr) {
  const pool = QUIZ_BANK.filter((q) => q.difficulty <= 2);
  return seededShuffle(pool, `arena-${dateStr}`).slice(0, 5);
}

// General quiz pick with optional subject filter
export function pickBankQuiz({ subject, count = 5, difficulty = null }) {
  let pool = QUIZ_BANK;
  if (subject) {
    const subj = subject.toLowerCase();
    const filtered = pool.filter((q) => q.subject.toLowerCase() === subj || q.topic.toLowerCase().includes(subj));
    if (filtered.length >= Math.min(count, 3)) pool = filtered;
  }
  if (difficulty) pool = pool.filter((q) => q.difficulty <= difficulty);
  return seededShuffle(pool, Date.now()).slice(0, count);
}
