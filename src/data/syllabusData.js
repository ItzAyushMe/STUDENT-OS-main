// ============================================================
// StudentOS — syllabus library
// Every syllabus is scoped: FIRST by class level, then board,
// then exam, then olympiad. A Class 10 student ALWAYS gets the
// Class 10 syllabus as their primary map — exam (JEE/NEET) and
// olympiad tracks are separate, optional layers.
//
//   pickSyllabusSet({ class_level, board, competitive_exam, olympiad })
//     -> { class: preset, exam: preset|null, olympiad: preset|null }
//
// Preset shape: { key, label, rows: [{ subject, chapter,
//   weightage 1-5, estimated_hours }] }
// ============================================================

const S = (subject, chapter, weightage, estimated_hours) => ({ subject, chapter, weightage, estimated_hours });

// ------------------------------------------------------------
// CLASS SYLLABI (the primary map — highest priority)
// ------------------------------------------------------------
export const CLASS_SYLLABI = {
  'Class 6': {
    key: 'class6',
    label: 'Class 6 · Full Syllabus (Science, Maths, SST, Languages, CS)',
    rows: [
      S('Science', 'Components of Food', 3, 4),
      S('Science', 'Sorting Materials into Groups', 2, 3),
      S('Science', 'Separation of Substances', 3, 4),
      S('Science', 'Getting to Know Plants', 3, 5),
      S('Science', 'Body Movements', 3, 4),
      S('Science', 'The Living Organisms — Characteristics & Habitats', 3, 5),
      S('Science', 'Motion and Measurement of Distances', 3, 4),
      S('Science', 'Light, Shadows and Reflections', 3, 4),
      S('Science', 'Electricity and Circuits', 4, 5),
      S('Science', 'Fun with Magnets', 3, 3),
      S('Science', 'Water', 3, 4),
      S('Science', 'Air Around Us', 2, 3),
      S('Science', 'Garbage In, Garbage Out', 2, 3),
      S('Maths', 'Knowing Our Numbers', 4, 6),
      S('Maths', 'Whole Numbers', 3, 5),
      S('Maths', 'Playing with Numbers', 4, 6),
      S('Maths', 'Basic Geometrical Ideas', 3, 5),
      S('Maths', 'Understanding Elementary Shapes', 3, 5),
      S('Maths', 'Integers', 4, 6),
      S('Maths', 'Fractions', 5, 8),
      S('Maths', 'Decimals', 4, 6),
      S('Maths', 'Data Handling', 3, 4),
      S('Maths', 'Mensuration', 4, 6),
      S('Maths', 'Algebra (Introduction)', 3, 5),
      S('Maths', 'Ratio and Proportion', 4, 5),
      // Languages + CS (v1.0.2 — full syllabus, not just Science+Maths)
      S('English', 'Reading Comprehension + Grammar', 3, 6),
      S('English', 'Prose + Poetry (Honeysuckle)', 3, 7),
      S('English', 'Writing — letters, stories, paragraphs', 2, 5),
      S('Hindi', 'Gadya + Padya (Vasant 1)', 3, 7),
      S('Hindi', 'Grammar + Writing (व्याकरण)', 3, 6),
      S('Computer Science', 'Computer Fundamentals + Internet basics', 3, 6),
      S('History', 'Our Past I — Early humans to first cities & kingdoms', 3, 6),
      S('Geography', 'The Earth in the Solar System + Maps + Major Landforms', 3, 6),
      S('Political Science', 'Understanding Diversity + What is Government', 3, 5),
    ],
  },

  'Class 7': {
    key: 'class7',
    label: 'Class 7 · Full Syllabus (Science, Maths, SST, Languages, CS)',
    rows: [
      S('Science', 'Nutrition in Plants', 3, 4),
      S('Science', 'Nutrition in Animals', 3, 4),
      S('Science', 'Heat', 3, 4),
      S('Science', 'Acids, Bases and Salts', 4, 5),
      S('Science', 'Physical and Chemical Changes', 3, 4),
      S('Science', 'Respiration in Organisms', 3, 4),
      S('Science', 'Transportation in Animals and Plants', 3, 5),
      S('Science', 'Reproduction in Plants', 4, 5),
      S('Science', 'Motion and Time', 4, 5),
      S('Science', 'Electric Current and its Effects', 4, 5),
      S('Science', 'Light', 4, 5),
      S('Science', 'Forests: Our Lifeline', 2, 3),
      S('Science', 'Wastewater Story', 2, 3),
      S('Maths', 'Integers', 4, 6),
      S('Maths', 'Fractions and Decimals', 5, 8),
      S('Maths', 'Data Handling', 3, 5),
      S('Maths', 'Simple Equations', 4, 6),
      S('Maths', 'Lines and Angles', 4, 5),
      S('Maths', 'The Triangle and its Properties', 4, 6),
      S('Maths', 'Comparing Quantities', 5, 7),
      S('Maths', 'Rational Numbers', 4, 6),
      S('Maths', 'Perimeter and Area', 4, 6),
      S('Maths', 'Algebraic Expressions', 4, 6),
      S('Maths', 'Exponents and Powers', 3, 5),
      S('Maths', 'Symmetry & Visualising Solid Shapes', 3, 5),
      // Languages + CS (v1.0.2)
      S('English', 'Reading Comprehension + Grammar', 3, 6),
      S('English', 'Prose + Poetry (Honeycomb)', 3, 7),
      S('English', 'Writing — letters, notices, stories', 2, 5),
      S('Hindi', 'Gadya + Padya (Vasant 2)', 3, 7),
      S('Hindi', 'Grammar + Writing (व्याकरण)', 3, 6),
      S('Computer Science', 'Computer Fundamentals + Internet basics', 3, 6),
      S('History', 'Our Past II — Medieval India: kings, kingdoms & cultures', 3, 6),
      S('Geography', 'Environment + Inside Our Earth + Air & Water', 3, 6),
      S('Political Science', 'Equality in Indian Democracy + State Government', 3, 5),
    ],
  },

  'Class 8': {
    key: 'class8',
    label: 'Class 8 · Full Syllabus (Science, Maths, SST, Languages, CS)',
    rows: [
      S('Science', 'Crop Production and Management', 3, 4),
      S('Science', 'Microorganisms: Friend and Foe', 3, 4),
      S('Science', 'Coal and Petroleum', 3, 4),
      S('Science', 'Combustion and Flame', 3, 4),
      S('Science', 'Conservation of Plants and Animals', 3, 4),
      S('Science', 'Reproduction in Animals', 3, 4),
      S('Science', 'Reaching the Age of Adolescence', 3, 4),
      S('Science', 'Force and Pressure', 4, 5),
      S('Science', 'Friction', 4, 5),
      S('Science', 'Sound', 4, 5),
      S('Science', 'Chemical Effects of Electric Current', 4, 5),
      S('Science', 'Some Natural Phenomena (Lightning, Earthquakes)', 3, 4),
      S('Science', 'Light', 4, 6),
      S('Maths', 'Rational Numbers', 4, 6),
      S('Maths', 'Linear Equations in One Variable', 5, 7),
      S('Maths', 'Understanding Quadrilaterals', 4, 6),
      S('Maths', 'Data Handling', 3, 5),
      S('Maths', 'Squares and Square Roots', 4, 6),
      S('Maths', 'Cubes and Cube Roots', 3, 5),
      S('Maths', 'Comparing Quantities', 5, 7),
      S('Maths', 'Algebraic Expressions and Identities', 4, 7),
      S('Maths', 'Mensuration', 5, 8),
      S('Maths', 'Exponents and Powers', 3, 4),
      S('Maths', 'Direct & Inverse Proportions + Factorisation', 4, 7),
      S('Maths', 'Introduction to Graphs', 3, 4),
      // Languages + CS (v1.0.2)
      S('English', 'Reading Comprehension + Grammar', 3, 6),
      S('English', 'Prose + Poetry (Honeydew)', 3, 7),
      S('English', 'Writing — letters, notices, essays', 2, 5),
      S('Hindi', 'Gadya + Padya (Vasant 3 / Durva)', 3, 7),
      S('Hindi', 'Grammar + Writing (व्याकरण)', 3, 6),
      S('Computer Science', 'Computer Fundamentals + Internet basics', 3, 6),
      S('History', 'Our Past III — Colonial India & 1857 to Independence', 3, 7),
      S('Geography', 'Resources + Agriculture + Industries + Human Resources', 3, 6),
      S('Political Science', 'The Indian Constitution + Parliament + Judiciary', 3, 6),
    ],
  },

  'Class 9': {
    key: 'class9',
    label: 'Class 9 · Full Syllabus (Science, Maths, SST, Languages, CS/AI)',
    rows: [
      S('Science', 'Matter in Our Surroundings', 3, 5),
      S('Science', 'Is Matter Around Us Pure?', 4, 6),
      S('Science', 'Atoms and Molecules', 4, 7),
      S('Science', 'Structure of the Atom', 4, 6),
      S('Science', 'The Fundamental Unit of Life', 4, 6),
      S('Science', 'Tissues', 3, 5),
      S('Science', 'Diversity in Living Organisms', 3, 5),
      S('Science', 'Motion', 5, 8),
      S('Science', 'Force and Laws of Motion', 5, 8),
      S('Science', 'Gravitation', 4, 7),
      S('Science', 'Work and Energy', 4, 6),
      S('Science', 'Sound', 4, 6),
      S('Science', 'Why Do We Fall Ill?', 3, 4),
      S('Science', 'Natural Resources + Improvement in Food Resources', 3, 5),
      S('Maths', 'Number Systems', 4, 7),
      S('Maths', 'Polynomials', 4, 7),
      S('Maths', 'Coordinate Geometry', 3, 5),
      S('Maths', 'Linear Equations in Two Variables', 4, 6),
      S('Maths', 'Introduction to Euclid’s Geometry', 2, 3),
      S('Maths', 'Lines and Angles', 4, 6),
      S('Maths', 'Triangles', 5, 8),
      S('Maths', 'Quadrilaterals', 4, 6),
      S('Maths', 'Circles', 4, 6),
      S('Maths', 'Heron’s Formula', 3, 5),
      S('Maths', 'Surface Areas and Volumes', 4, 7),
      S('Maths', 'Statistics', 3, 5),
      // Languages + CS/AI (v1.0.2)
      S('English', 'Reading Comprehension + Grammar', 3, 6),
      S('English', 'Prose + Poetry (Beehive)', 3, 7),
      S('English', 'Moments (supplementary reader) + Writing skills', 2, 5),
      S('Hindi', 'Gadya + Padya (Sparsh / Kshitij)', 3, 7),
      S('Hindi', 'Grammar + Writing (व्याकरण)', 3, 6),
      S('Computer Science / AI', 'Python + Intro to AI/ML', 4, 10),
      // Social Science (NCERT Class 9)
      S('History', 'The French Revolution', 4, 6),
      S('History', 'Socialism in Europe and the Russian Revolution', 3, 5),
      S('History', 'Nazism and the Rise of Hitler', 4, 5),
      S('History', 'Forest Society and Colonialism + Pastoralists', 2, 4),
      S('Political Science', 'What is Democracy? Why Democracy?', 4, 5),
      S('Political Science', 'Constitutional Design + Electoral Politics', 4, 6),
      S('Political Science', 'Working of Institutions + Democratic Rights', 4, 6),
      S('Geography', 'India — Size and Location + Physical Features', 3, 5),
      S('Geography', 'Drainage + Climate', 4, 6),
      S('Geography', 'Natural Vegetation, Wildlife + Population', 3, 5),
      S('Economics', 'The Story of Village Palampur + People as Resource', 3, 5),
      S('Economics', 'Poverty as a Challenge + Food Security in India', 3, 5),
    ],
  },

  'Class 10': {
    key: 'class10',
    label: 'Class 10 · Full Syllabus (Science, Maths, SST, Languages, CS/AI)',
    rows: [
      S('Science', 'Chemical Reactions and Equations', 4, 6),
      S('Science', 'Acids, Bases and Salts', 4, 7),
      S('Science', 'Metals and Non-metals', 4, 8),
      S('Science', 'Carbon and its Compounds', 5, 9),
      S('Science', 'Life Processes', 5, 10),
      S('Science', 'Control and Coordination', 3, 7),
      S('Science', 'How do Organisms Reproduce?', 4, 8),
      S('Science', 'Heredity and Evolution', 3, 6),
      S('Science', 'Light — Reflection and Refraction', 5, 10),
      S('Science', 'The Human Eye and the Colourful World', 4, 6),
      S('Science', 'Electricity', 5, 10),
      S('Science', 'Magnetic Effects of Electric Current', 4, 7),
      S('Science', 'Our Environment', 2, 4),
      S('Maths', 'Real Numbers', 3, 6),
      S('Maths', 'Polynomials', 3, 6),
      S('Maths', 'Pair of Linear Equations in Two Variables', 4, 8),
      S('Maths', 'Quadratic Equations', 4, 8),
      S('Maths', 'Arithmetic Progressions', 3, 6),
      S('Maths', 'Triangles', 4, 8),
      S('Maths', 'Coordinate Geometry', 3, 6),
      S('Maths', 'Introduction to Trigonometry', 5, 10),
      S('Maths', 'Some Applications of Trigonometry', 3, 4),
      S('Maths', 'Circles', 3, 6),
      S('Maths', 'Areas Related to Circles', 3, 6),
      S('Maths', 'Surface Areas and Volumes', 4, 7),
      S('Maths', 'Statistics', 3, 6),
      S('Maths', 'Probability', 3, 5),
      // Languages + CS/AI (v1.0.2)
      S('English', 'Reading Comprehension + Grammar', 3, 6),
      S('English', 'Prose + Poetry (First Flight)', 3, 7),
      S('English', 'Footprints without Feet + Writing (letters, analysis)', 2, 5),
      S('Hindi', 'Gadya + Padya (Sparsh / Kshitij)', 3, 7),
      S('Hindi', 'Grammar + Writing (व्याकरण)', 3, 6),
      S('Computer Science / AI', 'Python + Intro to AI/ML', 4, 10),
      // Social Science (NCERT Class 10)
      S('History', 'The Rise of Nationalism in Europe', 4, 6),
      S('History', 'Nationalism in India', 5, 8),
      S('History', 'The Making of a Global World', 3, 5),
      S('History', 'The Age of Industrialisation', 3, 5),
      S('History', 'Print Culture and the Modern World', 4, 6),
      S('Political Science', 'Power-sharing', 4, 5),
      S('Political Science', 'Federalism', 4, 6),
      S('Political Science', 'Gender, Religion and Caste', 3, 5),
      S('Political Science', 'Political Parties', 4, 5),
      S('Political Science', 'Outcomes of Democracy', 3, 4),
      S('Geography', 'Resources and Development', 4, 5),
      S('Geography', 'Forest and Wildlife Resources', 3, 4),
      S('Geography', 'Water Resources', 4, 5),
      S('Geography', 'Agriculture', 4, 6),
      S('Geography', 'Minerals and Energy Resources', 4, 6),
      S('Geography', 'Manufacturing Industries', 4, 6),
      S('Geography', 'Lifelines of National Economy', 3, 5),
      S('Economics', 'Development', 4, 5),
      S('Economics', 'Sectors of the Indian Economy', 4, 6),
      S('Economics', 'Money and Credit', 4, 6),
      S('Economics', 'Globalisation and the Indian Economy', 4, 6),
      S('Economics', 'Consumer Rights', 3, 4),
    ],
  },

  'Class 11': {
    key: 'class11',
    label: 'Class 11 · PCM (Science stream)',
    rows: [
      S('Physics', 'Units and Measurement', 2, 4),
      S('Physics', 'Motion in a Straight Line', 4, 7),
      S('Physics', 'Motion in a Plane', 4, 8),
      S('Physics', 'Laws of Motion', 5, 10),
      S('Physics', 'Work, Energy and Power', 4, 8),
      S('Physics', 'System of Particles and Rotational Motion', 5, 12),
      S('Physics', 'Gravitation', 3, 6),
      S('Physics', 'Mechanical Properties of Solids & Fluids', 4, 10),
      S('Physics', 'Thermal Properties & Thermodynamics', 4, 10),
      S('Physics', 'Kinetic Theory of Gases', 3, 6),
      S('Physics', 'Oscillations', 4, 8),
      S('Physics', 'Waves', 4, 8),
      S('Chemistry', 'Some Basic Concepts of Chemistry', 3, 6),
      S('Chemistry', 'Structure of Atom', 4, 7),
      S('Chemistry', 'Classification of Elements & Periodicity', 3, 5),
      S('Chemistry', 'Chemical Bonding and Molecular Structure', 5, 9),
      S('Chemistry', 'Thermodynamics', 4, 8),
      S('Chemistry', 'Equilibrium', 4, 9),
      S('Chemistry', 'Redox Reactions', 3, 5),
      S('Chemistry', 'The p-Block Elements (Group 13–14)', 3, 6),
      S('Chemistry', 'Organic Chemistry — Basic Principles', 4, 9),
      S('Chemistry', 'Hydrocarbons', 4, 8),
      S('Maths', 'Sets, Relations and Functions', 4, 8),
      S('Maths', 'Complex Numbers and Quadratic Equations', 4, 8),
      S('Maths', 'Linear Inequalities', 2, 4),
      S('Maths', 'Permutations and Combinations', 4, 7),
      S('Maths', 'Binomial Theorem', 3, 5),
      S('Maths', 'Sequences and Series', 4, 7),
      S('Maths', 'Straight Lines & Conic Sections', 5, 12),
      S('Maths', 'Introduction to 3-D Geometry', 2, 4),
      S('Maths', 'Limits and Derivatives', 5, 10),
      S('Maths', 'Probability', 3, 6),
      // Languages + CS/AI (v1.0.2)
      S('English', 'Reading Comprehension + Grammar', 3, 6),
      S('English', 'Prose + Poetry (Hornbill)', 3, 7),
      S('English', 'Writing — notices, reports, note-making', 2, 5),
      S('Hindi', 'Gadya + Padya (Aroh / Vitan)', 3, 7),
      S('Hindi', 'Grammar + Writing (व्याकरण)', 3, 6),
      S('Computer Science / AI', 'Python + Intro to AI/ML', 4, 10),
      // Humanities core (v1.0.2 — for students with SST subjects)
      S('History', 'Themes in World History — Early Societies to Nomadic Empires', 3, 8),
      S('History', 'The Industrial Revolution + Paths to Modernisation', 3, 7),
      S('Political Science', 'Indian Constitution at Work', 4, 10),
      S('Political Science', 'Political Theory — An Introduction', 3, 7),
      S('Geography', 'Fundamentals of Physical Geography', 4, 10),
      S('Geography', 'India — Physical Environment', 3, 7),
      S('Economics', 'Indian Economic Development', 4, 10),
      S('Economics', 'Statistics for Economics', 3, 8),
    ],
  },

  'Class 12': {
    key: 'class12',
    label: 'Class 12 · PCM (Science stream)',
    rows: [
      S('Physics', 'Electric Charges and Fields', 5, 10),
      S('Physics', 'Electrostatic Potential and Capacitance', 5, 10),
      S('Physics', 'Current Electricity', 5, 11),
      S('Physics', 'Moving Charges and Magnetism', 5, 11),
      S('Physics', 'Magnetism and Matter', 3, 6),
      S('Physics', 'Electromagnetic Induction', 4, 8),
      S('Physics', 'Alternating Current', 4, 8),
      S('Physics', 'Electromagnetic Waves', 2, 4),
      S('Physics', 'Ray Optics and Optical Instruments', 5, 11),
      S('Physics', 'Wave Optics', 4, 8),
      S('Physics', 'Dual Nature of Radiation and Matter', 3, 6),
      S('Physics', 'Atoms and Nuclei', 4, 8),
      S('Physics', 'Semiconductor Electronics', 4, 8),
      S('Chemistry', 'Solutions', 4, 8),
      S('Chemistry', 'Electrochemistry', 5, 9),
      S('Chemistry', 'Chemical Kinetics', 5, 9),
      S('Chemistry', 'd- and f-Block Elements', 4, 8),
      S('Chemistry', 'Coordination Compounds', 5, 9),
      S('Chemistry', 'Haloalkanes and Haloarenes', 4, 7),
      S('Chemistry', 'Alcohols, Phenols and Ethers', 4, 8),
      S('Chemistry', 'Aldehydes, Ketones and Carboxylic Acids', 5, 10),
      S('Chemistry', 'Amines', 4, 7),
      S('Chemistry', 'Biomolecules', 3, 6),
      S('Maths', 'Relations and Functions', 4, 7),
      S('Maths', 'Inverse Trigonometric Functions', 3, 5),
      S('Maths', 'Matrices', 4, 8),
      S('Maths', 'Determinants', 5, 9),
      S('Maths', 'Continuity and Differentiability', 5, 11),
      S('Maths', 'Application of Derivatives', 4, 9),
      S('Maths', 'Integrals', 5, 13),
      S('Maths', 'Application of Integrals', 3, 6),
      S('Maths', 'Differential Equations', 4, 8),
      S('Maths', 'Vector Algebra', 4, 7),
      S('Maths', 'Three-Dimensional Geometry', 5, 9),
      S('Maths', 'Linear Programming', 2, 4),
      S('Maths', 'Probability', 4, 8),
      // Languages + CS/AI (v1.0.2)
      S('English', 'Reading Comprehension + Writing (Flamingo)', 3, 6),
      S('English', 'Prose + Poetry (Flamingo) + Vistas', 3, 7),
      S('Hindi', 'Gadya + Padya (Aroh / Vitan)', 3, 7),
      S('Hindi', 'Grammar + Writing (व्याकरण)', 3, 6),
      S('Computer Science / AI', 'Python + Intro to AI/ML', 4, 10),
      // Humanities core (v1.0.2)
      S('History', 'Bricks, Beads and Bones + Kings, Farmers and Towns', 4, 10),
      S('History', 'Bhakti-Sufi Traditions + Vijayanagara Empire', 3, 8),
      S('History', 'Colonialism and the Countryside + Rebels and the Raj', 4, 9),
      S('History', 'Mahatma Gandhi and the Nationalist Movement + Framing the Constitution', 4, 9),
      S('Political Science', 'Contemporary World Politics', 4, 10),
      S('Political Science', 'Politics in India Since Independence', 4, 10),
      S('Geography', 'Fundamentals of Human Geography', 4, 9),
      S('Geography', 'India — People and Economy', 4, 10),
      S('Economics', 'Introductory Macroeconomics', 4, 10),
      S('Economics', 'Indian Economic Development', 3, 8),
    ],
  },

  'College': {
    key: 'college',
    label: 'College · Core Semester 1–2 (adapt to your course)',
    rows: [
      S('Core', 'Mathematics I — Calculus & Linear Algebra', 5, 14),
      S('Core', 'Programming Fundamentals', 5, 16),
      S('Core', 'Physics / Electronics Basics', 4, 12),
      S('Core', 'Communication Skills', 3, 8),
      S('Core', 'Engineering Graphics / Workshop', 3, 8),
      S('Core', 'Mathematics II — Probability & Stats', 4, 12),
      S('Core', 'Data Structures', 5, 16),
      S('Core', 'Digital Logic / Circuits', 4, 12),
      S('Core', 'Discrete Mathematics', 4, 12),
      S('Core', 'Environmental Science', 2, 6),
    ],
  },
};

// Class 11/12 PCB variant (for NEET-aspirants in senior classes)
export const CLASS11_12_PCB = {
  key: 'class11_12_pcb',
  label: 'Class 11–12 · PCB (Biology stream)',
  rows: [
    S('Physics', 'Current Electricity + Electrostatics (basics)', 4, 14),
    S('Physics', 'Magnetism + EMI (basics)', 3, 10),
    S('Physics', 'Optics', 4, 12),
    S('Chemistry', 'Organic Chemistry — GOC + Hydrocarbons', 5, 14),
    S('Chemistry', 'Chemical + Ionic Equilibrium', 4, 10),
    S('Chemistry', 'Biomolecules & Polymers', 3, 7),
    S('Biology', 'Cell — The Unit of Life', 5, 10),
    S('Biology', 'Plant & Human Physiology', 5, 16),
    S('Biology', 'Genetics and Evolution', 5, 14),
    S('Biology', 'Reproduction (Plants + Human)', 4, 12),
    S('Biology', 'Biotechnology & Ecology', 4, 10),
  ],
};

// ------------------------------------------------------------
// EXAM TRACKS (secondary layer — "only after class + olympiad")
// ------------------------------------------------------------
export const EXAM_SYLLABI = {
  'JEE Main': {
    key: 'jee',
    label: 'JEE Track · Main + Advanced (Class 11–12 level)',
    rows: [
      S('Physics (JEE)', 'Kinematics + Projectile Motion (JEE level)', 4, 10),
      S('Physics (JEE)', 'Newton’s Laws + Friction (JEE problems)', 5, 12),
      S('Physics (JEE)', 'Work-Energy + Rotational Dynamics', 5, 14),
      S('Physics (JEE)', 'Electrostatics + Capacitors (JEE)', 5, 12),
      S('Physics (JEE)', 'Current Electricity + Circuits (JEE)', 5, 11),
      S('Physics (JEE)', 'Magnetism + EMI (JEE)', 4, 11),
      S('Physics (JEE)', 'Optics — Ray + Wave (JEE)', 4, 10),
      S('Physics (JEE)', 'Modern Physics (JEE)', 4, 8),
      S('Chemistry (JEE)', 'Mole Concept + Stoichiometry (JEE)', 4, 8),
      S('Chemistry (JEE)', 'Atomic Structure + Chemical Bonding (JEE)', 5, 12),
      S('Chemistry (JEE)', 'Thermo + Equilibrium (JEE)', 5, 12),
      S('Chemistry (JEE)', 'Electrochemistry + Kinetics (JEE)', 4, 10),
      S('Chemistry (JEE)', 'GOC + Reaction Mechanisms (JEE)', 5, 14),
      S('Chemistry (JEE)', 'Coordination Compounds + p-Block (JEE)', 4, 12),
      S('Maths (JEE)', 'Quadratics + Complex Numbers (JEE)', 5, 12),
      S('Maths (JEE)', 'Sequences & Series (JEE)', 4, 8),
      S('Maths (JEE)', 'Trigonometry + Inverse Trig (JEE)', 4, 10),
      S('Maths (JEE)', 'Straight Lines + Circles (JEE)', 5, 12),
      S('Maths (JEE)', 'Conic Sections (JEE)', 5, 12),
      S('Maths (JEE)', 'Limits, Continuity, Differentiability (JEE)', 5, 12),
      S('Maths (JEE)', 'Application of Derivatives + Maxima-Minima', 5, 10),
      S('Maths (JEE)', 'Definite Integration + Area (JEE)', 5, 12),
      S('Maths (JEE)', 'Vectors + 3D Geometry (JEE)', 4, 10),
      S('Maths (JEE)', 'Probability + P&C (JEE)', 4, 9),
    ],
  },

  NEET: {
    key: 'neet',
    label: 'NEET Track · Biology-first (NCERT + beyond)',
    rows: [
      S('Biology (NEET)', 'Cell Structure & Cell Cycle (NCERT deep-dive)', 5, 12),
      S('Biology (NEET)', 'Plant Physiology — Transport + Photosynthesis', 5, 14),
      S('Biology (NEET)', 'Human Physiology — Digestion + Respiration', 5, 14),
      S('Biology (NEET)', 'Human Physiology — Circulation + Excretion', 5, 13),
      S('Biology (NEET)', 'Neural + Endocrine Control', 4, 10),
      S('Biology (NEET)', 'Reproduction — Plants + Human', 5, 13),
      S('Biology (NEET)', 'Genetics + Molecular Basis of Inheritance', 5, 15),
      S('Biology (NEET)', 'Evolution', 3, 7),
      S('Biology (NEET)', 'Human Health and Disease', 4, 9),
      S('Biology (NEET)', 'Biotechnology + Its Applications', 4, 9),
      S('Biology (NEET)', 'Ecology + Biodiversity', 5, 11),
      S('Chemistry (NEET)', 'Organic Chemistry (NCERT + NEET patterns)', 5, 16),
      S('Chemistry (NEET)', 'Physical Chemistry core formulas', 4, 12),
      S('Physics (NEET)', 'Mechanics + Electricity (NEET level)', 4, 14),
    ],
  },

  NTSE: {
    key: 'ntse',
    label: 'NTSE Track · MAT + SAT',
    rows: [
      S('NTSE MAT', 'Analogy + Classification', 4, 6),
      S('NTSE MAT', 'Series (Number + Alphabet)', 4, 6),
      S('NTSE MAT', 'Coding-Decoding + Blood Relations', 4, 6),
      S('NTSE MAT', 'Non-Verbal Reasoning', 4, 7),
      S('NTSE SAT', 'Maths — Arithmetic + Algebra basics', 4, 10),
      S('NTSE SAT', 'Science (Class 9–10 recap)', 4, 12),
      S('NTSE SAT', 'Social Science + GK', 3, 8),
    ],
  },
};

// ------------------------------------------------------------
// OLYMPIAD TRACKS (second priority — after class, before exam)
// ------------------------------------------------------------
export const OLYMPIAD_SYLLABI = {
  'IOQM': {
    key: 'ioqm',
    label: 'IOQM Track · Maths Olympiad (pre-RMO)',
    rows: [
      S('Maths Olympiad', 'Number Theory — divisibility, mod arithmetic', 5, 12),
      S('Maths Olympiad', 'Algebra — inequalities & identities', 4, 10),
      S('Maths Olympiad', 'Geometry — angle chasing, circles', 5, 12),
      S('Maths Olympiad', 'Combinatorics — counting, Pigeonhole', 4, 10),
      S('Maths Olympiad', 'Polynomials + Functional equations basics', 4, 9),
      S('Maths Olympiad', 'Past IOQM/RMO papers — timed solving', 5, 12),
    ],
  },

  'IMO (Maths)': {
    key: 'imo',
    label: 'IMO Track · SOF International Maths Olympiad',
    rows: [
      S('IMO', 'Logical Reasoning', 3, 6),
      S('IMO', 'Mathematical Reasoning', 4, 8),
      S('IMO', 'Everyday Maths + Arithmetic', 4, 8),
      S('IMO', 'Achievers Section (HOTS)', 4, 8),
    ],
  },

  'NSO (Science)': {
    key: 'nso',
    label: 'NSO Track · SOF Science Olympiad',
    rows: [
      S('NSO', 'Physics — Motion, Force, Energy (Olympiad level)', 4, 8),
      S('NSO', 'Chemistry — Matter + Atoms (Olympiad level)', 4, 8),
      S('NSO', 'Biology — Cells, Plants, Human Body (Olympiad)', 4, 8),
      S('NSO', 'Logical Reasoning + HOTS', 3, 6),
    ],
  },

  'NSEP (Physics)': {
    key: 'nsep',
    label: 'NSEP Track · Physics Olympiad',
    rows: [
      S('Physics Olympiad', 'Mechanics — advanced problems', 5, 14),
      S('Physics Olympiad', 'Electromagnetism — advanced problems', 5, 12),
      S('Physics Olympiad', 'Optics + Waves (Olympiad level)', 4, 10),
      S('Physics Olympiad', 'Thermo + Fluids (Olympiad level)', 4, 10),
    ],
  },

  'NSEC (Chemistry)': {
    key: 'nsec',
    label: 'NSEC Track · Chemistry Olympiad',
    rows: [
      S('Chemistry Olympiad', 'Physical Chemistry — advanced', 5, 12),
      S('Chemistry Olympiad', 'Inorganic — advanced', 4, 10),
      S('Chemistry Olympiad', 'Organic — mechanisms + synthesis', 5, 12),
    ],
  },
};

// ------------------------------------------------------------
// THE PICKER — class FIRST, olympiad second, exam LAST
// ------------------------------------------------------------
function normalizeClass(classLevel = '') {
  const c = String(classLevel || '').toLowerCase();
  if (c.includes('college') || c.includes('year')) return 'College';
  const m = c.match(/class\s*(\d+)/) || c.match(/(\d{1,2})(st|nd|rd|th)/);
  const n = m ? parseInt(m[1], 10) : null;
  if (n >= 6 && n <= 8) return `Class ${n}`;
  if (n === 9 || n === 10) return `Class ${n}`;
  if (n === 11 || n === 12) return `Class ${n}`;
  return null;
}

export function pickClassSyllabus({ class_level = '', board = '', competitive_exam = '' } = {}) {
  const cls = normalizeClass(class_level);
  // senior science students aiming NEET get the PCB variant of their class
  if ((cls === 'Class 11' || cls === 'Class 12') && String(competitive_exam || '').toUpperCase().includes('NEET')) {
    return CLASS11_12_PCB;
  }
  if (cls && CLASS_SYLLABI[cls]) return CLASS_SYLLABI[cls];
  if (cls === 'Class 11' || cls === 'Class 12') return CLASS_SYLLABI['Class 11']; // fallback
  return null; // unknown/college — AI or manual
}

export function pickExamSyllabus({ competitive_exam = '', class_level = '' } = {}) {
  const exam = String(competitive_exam || '');
  if (!exam || exam === 'None') return null;
  const up = exam.toUpperCase();
  if (up.includes('JEE')) return EXAM_SYLLABI['JEE Main'];
  if (up.includes('NEET')) return EXAM_SYLLABI.NEET;
  if (up.includes('NTSE')) return EXAM_SYLLABI.NTSE;
  // JEE-adjacent exams (KVPY/INSPIRE) reuse the JEE track
  if (up.includes('KVPY') || up.includes('INSPIRE')) return EXAM_SYLLABI['JEE Main'];
  return null;
}

export function pickOlympiadSyllabus({ olympiad = '' } = {}) {
  const o = String(olympiad || '');
  if (!o || o === 'None') return null;
  if (OLYMPIAD_SYLLABI[o]) return OLYMPIAD_SYLLABI[o];
  const up = o.toUpperCase();
  if (up.includes('IOQM') || up.includes('INMO') || up.includes('RMO')) return OLYMPIAD_SYLLABI.IOQM;
  if (up.includes('IMO')) return OLYMPIAD_SYLLABI['IMO (Maths)'];
  if (up.includes('NSO')) return OLYMPIAD_SYLLABI['NSO (Science)'];
  if (up.includes('NSEP')) return OLYMPIAD_SYLLABI['NSEP (Physics)'];
  if (up.includes('NSEC')) return OLYMPIAD_SYLLABI['NSEC (Chemistry)'];
  return null;
}

// Main entry: returns the full set for a profile. CLASS ALWAYS WINS.
export function pickSyllabusSet(profile = {}) {
  return {
    class: pickClassSyllabus(profile),
    exam: pickExamSyllabus(profile),
    olympiad: pickOlympiadSyllabus(profile),
  };
}

// Track metadata used across the app (tabs, badges, scheduler colors)
export const TRACKS = {
  class: { key: 'class', label: 'My Class', short: 'Class', icon: '🏫', color: '#7C3AED', priority: 1 },
  olympiad: { key: 'olympiad', label: 'My Olympiad', short: 'Olympiad', icon: '🏅', color: '#F59E0B', priority: 2 },
  exam: { key: 'exam', label: 'My Exam', short: 'Exam', icon: '🎯', color: '#EF4444', priority: 3 },
};
