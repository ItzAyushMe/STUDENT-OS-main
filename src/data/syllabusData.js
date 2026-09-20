// ============================================================
// StudentOS — syllabus library
// FIX-B: Class 6/7/8 + College DELETED per PO PDF — only 9-12 remain
// Class 9 = Appendix A, Class 10 = Appendix B — verbatim NCERT names
// ============================================================

const S = (subject, chapter, weightage, estimated_hours) => ({ subject, chapter, weightage, estimated_hours });

export const CLASS_SYLLABI = {
  'Class 9': {
    key: 'class9',
    label: 'Class 9 · Full Syllabus — Appendix A (Science, Maths incl. Part 2 speculative, SST 4 books, English Beehive+Moments, Hindi Sparsh+Sanchayan, AI 417)',
    rows: [

      // Science — Physics (Class 9)
      S('Science', 'Matter in Our Surroundings', 3, 8),
      S('Science', 'Is Matter Around Us Pure', 4, 9),
      S('Science', 'Atoms and Molecules', 4, 10),
      S('Science', 'Structure of the Atom', 4, 10),
      S('Science', 'The Fundamental Unit of Life', 4, 10),
      S('Science', 'Tissues', 3, 8),
      S('Science', 'Motion', 5, 10),
      S('Science', 'Force and Laws of Motion', 5, 11),
      S('Science', 'Gravitation', 4, 10),
      S('Science', 'Work and Energy', 4, 9),
      S('Science', 'Sound', 4, 9),
      S('Science', 'Why Do We Fall Ill', 3, 7),
      S('Science', 'Natural Resources', 3, 8),
      S('Science', 'Improvement in Food Resources', 3, 8),

      // Maths — Class 9 (12 chapters, Part 1 + Part 2 speculative)
      S('Maths', 'Number Systems', 4, 10),
      S('Maths', 'Polynomials', 4, 10),
      S('Maths', 'Coordinate Geometry', 3, 8),
      S('Maths', 'Linear Equations in Two Variables', 4, 9),
      S('Maths', 'Introduction to Euclid’s Geometry', 2, 6),
      S('Maths', 'Lines and Angles', 4, 9),
      S('Maths', 'Triangles', 5, 11),
      S('Maths', 'Quadrilaterals', 4, 9),
      S('Maths', 'Circles', 4, 9),
      S('Maths', 'Heron’s Formula', 3, 8),
      S('Maths', 'Surface Areas and Volumes', 4, 10),
      S('Maths', 'Statistics', 3, 8),
      // Part 2 speculative (as per source flag)
      S('Maths', 'Probability (Part 2 — speculative)', 3, 7),

      // History — Class 9
      S('History', 'The French Revolution', 4, 10),
      S('History', 'Socialism in Europe and the Russian Revolution', 4, 10),
      S('History', 'Nazism and the Rise of Hitler', 4, 10),
      S('History', 'Forest Society and Colonialism', 3, 8),
      S('History', 'Pastoralists in the Modern World', 3, 7),

      // Geography — Class 9
      S('Geography', 'India – Size and Location', 4, 8),
      S('Geography', 'Physical Features of India', 4, 9),
      S('Geography', 'Drainage', 4, 9),
      S('Geography', 'Climate', 4, 9),
      S('Geography', 'Natural Vegetation and Wildlife', 3, 8),
      S('Geography', 'Population', 3, 8),

      // Political Science — Class 9
      S('Political Science', 'What is Democracy? Why Democracy?', 4, 9),
      S('Political Science', 'Constitutional Design', 4, 10),
      S('Political Science', 'Electoral Politics', 4, 9),
      S('Political Science', 'Working of Institutions', 4, 10),
      S('Political Science', 'Democratic Rights', 4, 9),

      // Economics — Class 9
      S('Economics', 'The Story of Village Palampur', 3, 9),
      S('Economics', 'People as Resource', 3, 8),
      S('Economics', 'Poverty as a Challenge', 3, 8),
      S('Economics', 'Food Security in India', 3, 8),

      // English — Beehive Prose (Class 9)
      S('English', 'The Fun They Had', 3, 7),
      S('English', 'The Sound of Music', 3, 8),
      S('English', 'The Little Girl', 3, 7),
      S('English', 'A Truly Beautiful Mind', 3, 8),
      S('English', 'The Snake and the Mirror', 3, 7),
      S('English', 'My Childhood', 4, 8),
      S('English', 'Reach for the Top', 3, 8),
      S('English', 'Kathmandu', 3, 7),
      S('English', 'If I Were You', 3, 7),

      // English — Beehive Poetry
      S('English', 'The Road Not Taken', 3, 6),
      S('English', 'Wind', 3, 6),
      S('English', 'Rain on the Roof', 3, 6),
      S('English', 'The Lake Isle of Innisfree', 3, 6),
      S('English', 'A Legend of the Northland', 3, 6),
      S('English', 'No Men Are Foreign', 3, 6),
      S('English', 'On Killing a Tree', 3, 6),
      S('English', 'A Slumber Did My Spirit Seal', 3, 6),

      // English — Moments Supplementary
      S('English', 'The Lost Child', 3, 7),
      S('English', 'The Adventures of Toto', 3, 7),
      S('English', 'Iswaran the Storyteller', 3, 7),
      S('English', 'In the Kingdom of Fools', 3, 7),
      S('English', 'The Happy Prince', 3, 7),
      S('English', 'Weathering the Storm in Ersama', 3, 7),
      S('English', 'The Last Leaf', 3, 7),
      S('English', 'A House is Not a Home', 3, 7),
      S('English', 'The Beggar', 3, 7),

      // Hindi — Sparsh (Gadya)
      S('Hindi', 'Dhool', 3, 7),
      S('Hindi', 'Dukh Ka Adhikar', 3, 7),
      S('Hindi', 'Everest: Meri Shikhar Yatra', 4, 8),
      S('Hindi', 'Tum Kab Jaoge, Atithi', 3, 7),
      S('Hindi', 'Vaigyanik Chetna Ke Vahak: Chandrashekhar Venkat Raman', 4, 8),
      S('Hindi', 'Dharm Ki Aad', 3, 7),
      S('Hindi', 'Shukrtare Ke Saman', 3, 7),

      // Hindi — Sparsh (Padya) — includes Kabir Ke Dohe verbatim
      S('Hindi', 'Kabir Ke Dohe', 4, 8),
      S('Hindi', 'Wakh', 3, 7),
      S('Hindi', 'Savaiye', 3, 7),
      S('Hindi', 'Gram Shree', 3, 7),
      S('Hindi', 'Megh Aaye', 3, 7),
      S('Hindi', 'Bacche Kaam Par Ja Rahe Hain', 3, 7),

      // Hindi — Sanchayan
      S('Hindi', 'Gillu', 3, 7),
      S('Hindi', 'Smriti', 3, 7),
      S('Hindi', 'Kallu Kumhar Ki Unakoti', 3, 7),
      S('Hindi', 'Mera Chhota Sa Niji Pustakalaya', 3, 7),

      // AI — 417 (Class 9)
      S('AI', 'AI Project Cycle', 4, 10),
      S('AI', 'Introduction to AI', 3, 8),
      S('AI', 'AI Ethics', 3, 8),
      S('AI', 'Data Literacy', 4, 9),
      S('AI', 'Introduction to Python (AI 417)', 4, 10),

    ],
  },

  'Class 10': {
    key: 'class10',
    label: 'Class 10 · Full Syllabus — Appendix B (Science, Maths, SST 4 books, English First Flight+Footprints, Hindi Kshitij+Kritika, AI 417)',
    rows: [

      // Science — Chemistry (Class 10)
      S('Science', 'Chemical Reactions and Equations', 4, 10),
      S('Science', 'Acids, Bases and Salts', 4, 10),
      S('Science', 'Metals and Non-metals', 4, 11),
      S('Science', 'Carbon and its Compounds', 5, 12),
      S('Science', 'Periodic Classification of Elements', 3, 9),

      // Science — Biology
      S('Science', 'Life Processes', 5, 12),
      S('Science', 'Control and Coordination', 4, 10),
      S('Science', 'How do Organisms Reproduce?', 4, 11),
      S('Science', 'Heredity and Evolution', 4, 10),
      S('Science', 'Our Environment', 3, 8),
      S('Science', 'Management of Natural Resources', 3, 7),

      // Science — Physics
      S('Science', 'Light – Reflection and Refraction', 5, 12),
      S('Science', 'The Human Eye and the Colourful World', 4, 10),
      S('Science', 'Electricity', 5, 12),
      S('Science', 'Magnetic Effects of Electric Current', 5, 11),
      S('Science', 'Sources of Energy', 3, 9),

      // Maths — Class 10
      S('Maths', 'Real Numbers', 4, 10),
      S('Maths', 'Polynomials', 4, 10),
      S('Maths', 'Pair of Linear Equations in Two Variables', 4, 12),
      S('Maths', 'Quadratic Equations', 5, 12),
      S('Maths', 'Arithmetic Progressions', 4, 11),
      S('Maths', 'Triangles', 4, 11),
      S('Maths', 'Coordinate Geometry', 4, 10),
      S('Maths', 'Introduction to Trigonometry', 5, 13),
      S('Maths', 'Some Applications of Trigonometry', 4, 10),
      S('Maths', 'Circles', 4, 10),
      S('Maths', 'Constructions', 3, 9),
      S('Maths', 'Areas Related to Circles', 4, 10),
      S('Maths', 'Surface Areas and Volumes', 5, 12),
      S('Maths', 'Statistics', 4, 11),
      S('Maths', 'Probability', 4, 10),

      // History — Class 10 (includes The Rise of Nationalism in Europe verbatim)
      S('History', 'The Rise of Nationalism in Europe', 4, 10),
      S('History', 'Nationalism in India', 5, 12),
      S('History', 'The Making of a Global World', 3, 9),
      S('History', 'The Age of Industrialisation', 3, 8),
      S('History', 'Print Culture and the Modern World', 4, 10),

      // Geography — Class 10
      S('Geography', 'Resources and Development', 4, 10),
      S('Geography', 'Forest and Wildlife Resources', 3, 9),
      S('Geography', 'Water Resources', 4, 10),
      S('Geography', 'Agriculture', 5, 12),
      S('Geography', 'Minerals and Energy Resources', 4, 10),
      S('Geography', 'Manufacturing Industries', 4, 10),
      S('Geography', 'Lifelines of National Economy', 4, 10),

      // Political Science — Class 10
      S('Political Science', 'Power Sharing', 4, 9),
      S('Political Science', 'Federalism', 4, 10),
      S('Political Science', 'Gender, Religion and Caste', 4, 9),
      S('Political Science', 'Political Parties', 4, 9),
      S('Political Science', 'Outcomes of Democracy', 3, 8),

      // Economics — Class 10
      S('Economics', 'Development', 4, 9),
      S('Economics', 'Sectors of the Indian Economy', 4, 10),
      S('Economics', 'Money and Credit', 4, 10),
      S('Economics', 'Globalisation and the Indian Economy', 4, 10),
      S('Economics', 'Consumer Rights', 3, 8),

      // English — First Flight Prose (includes A Letter to God verbatim)
      S('English', 'A Letter to God', 4, 8),
      S('English', 'Nelson Mandela: Long Walk to Freedom', 4, 9),
      S('English', 'Two Stories About Flying', 4, 9),
      S('English', 'From the Diary of Anne Frank', 4, 10),
      S('English', 'Glimpses of India', 4, 9),
      S('English', 'Mijbil the Otter', 4, 9),
      S('English', 'Madam Rides the Bus', 4, 9),
      S('English', 'The Sermon at Benares', 4, 9),
      S('English', 'The Proposal', 4, 9),

      // English — First Flight Poetry
      S('English', 'Dust of Snow', 3, 6),
      S('English', 'Fire and Ice', 3, 6),
      S('English', 'A Tiger in the Zoo', 3, 6),
      S('English', 'How to Tell Wild Animals', 3, 6),
      S('English', 'The Ball Poem', 3, 6),
      S('English', 'Amanda!', 3, 6),
      S('English', 'The Trees', 3, 6),
      S('English', 'Fog', 3, 6),
      S('English', 'The Tale of Custard the Dragon', 3, 7),
      S('English', 'For Anne Gregory', 3, 6),

      // English — Footprints Without Feet
      S('English', 'A Triumph of Surgery', 3, 7),
      S('English', 'The Thief’s Story', 3, 7),
      S('English', 'The Midnight Visitor', 3, 7),
      S('English', 'A Question of Trust', 3, 7),
      S('English', 'Footprints Without Feet', 3, 7),
      S('English', 'The Making of a Scientist', 3, 7),
      S('English', 'The Necklace', 3, 7),
      S('English', 'Bholi', 3, 7),
      S('English', 'The Book That Saved the Earth', 3, 7),

      // Hindi — Kshitij (Gadya + Padya) — Class 10
      S('Hindi', 'Surdas Ke Pad', 3, 7),
      S('Hindi', 'Tulsidas Ke Pad', 3, 7),
      S('Hindi', 'Dev – Savaiya Aur Kavitta', 3, 7),
      S('Hindi', 'Jayashankar Prasad – Atmakathya', 3, 7),
      S('Hindi', 'Suryakant Tripathi Nirala – Utsah, At Nahi Rahi Hai', 4, 8),
      S('Hindi', 'Nagarjun – Yeh Danturit Muskaan, Fasal', 4, 8),
      S('Hindi', 'Girija Kumar Mathur – Chhaya Mat Chhuna', 3, 7),
      S('Hindi', 'Rituraj – Kanyadaan', 3, 7),
      S('Hindi', 'Manglesh Dabral – Sangtaraash', 3, 7),
      S('Hindi', 'Self Introduction – Harivansh Rai Bachchan', 3, 7),
      S('Hindi', 'Balgobin Bhagat – Ramvriksha Benipuri', 3, 7),
      S('Hindi', 'Lakhnavi Andaaz – Yashpal', 3, 7),
      S('Hindi', 'Manavta – Maitreyi Pushpa', 3, 7),
      S('Hindi', 'Ek Kahani Yeh Bhi – Mannu Bhandari', 3, 7),
      S('Hindi', 'Stree Shiksha Ke Virodhi Kutarkon Ka Khandan – Mahavir Prasad Dwivedi', 3, 7),
      S('Hindi', 'Naubat Khane Mein Ibaadat – Yatindra Mishra', 3, 7),
      S('Hindi', 'Sanskriti – Bhadant Anand Kausalyayan', 3, 7),

      // Hindi — Kritika
      S('Hindi', 'Mata Ka Aanchal – Shivprasad Singh', 3, 7),
      S('Hindi', 'George Pancham Ki Naak – Kamleshwar', 3, 7),
      S('Hindi', 'Sana-Sana Hath Jodi – Madhav Rao Sapre', 3, 7),
      S('Hindi', 'Ahi Thaiya Jhulni Herani Ho Ram – Vidyanath Mishra', 3, 7),
      S('Hindi', 'Main Kyun Likhta Hoon – Agyeya', 3, 7),

      // AI — 417 (Class 10)
      S('AI', 'AI Project Cycle', 4, 10),
      S('AI', 'Data Literacy', 4, 9),
      S('AI', 'Machine Learning', 4, 10),
      S('AI', 'Computer Vision', 4, 10),
      S('AI', 'Natural Language Processing', 4, 10),
      S('AI', 'AI Ethics and Values', 3, 8),
      S('AI', 'Introduction to Python (AI 417)', 4, 10),
      S('AI', 'AI Applications in Real Life', 3, 8),

    ],
  },

  'Class 11': {
    key: 'class11',
    label: 'Class 11 · Full Syllabus (Science, Commerce, Humanities) — v1.0.6 expanded',
    rows: [
      S('Physics', 'Units and Measurement — Errors & Significant Figures', 3, 6),
      S('Physics', 'Motion in a Straight Line — Position, Velocity, Acceleration', 4, 8),
      S('Physics', 'Motion in a Straight Line — Kinematic Equations & Graphs', 4, 8),
      S('Physics', 'Motion in a Plane — Vectors & Resolution', 4, 9),
      S('Physics', 'Motion in a Plane — Projectile & Circular Motion', 4, 9),
      S('Physics', 'Laws of Motion — Newton Laws & Friction', 5, 11),
      S('Physics', 'Laws of Motion — Circular Motion & Banking', 4, 9),
      S('Physics', 'Work, Energy and Power — Work & Energy Forms', 4, 9),
      S('Physics', 'Work, Energy and Power — Power & Collision', 4, 9),
      S('Physics', 'System of Particles — Centre of Mass & Moment of Inertia', 4, 10),
      S('Physics', 'Rotational Motion — Torque, Angular Momentum & Rolling', 5, 12),
      S('Physics', 'Gravitation — Universal Law & Satellite Motion', 4, 9),
      S('Physics', 'Mechanical Properties — Elasticity & Stress-Strain', 3, 7),
      S('Physics', 'Mechanical Properties — Fluids: Pressure, Viscosity, Surface Tension', 4, 9),
      S('Physics', 'Thermal Properties — Temperature, Expansion, Calorimetry', 4, 9),
      S('Physics', 'Thermodynamics — Laws & Processes', 4, 10),
      S('Physics', 'Kinetic Theory — Ideal Gas & Degrees of Freedom', 3, 7),
      S('Physics', 'Oscillations — SHM & Energy', 4, 9),
      S('Physics', 'Waves — Transverse, Longitudinal & Superposition', 4, 9),
      S('Physics', 'Waves — Doppler & Beats', 3, 7),
      S('Chemistry', 'Some Basic Concepts — Mole & Stoichiometry', 4, 9),
      S('Chemistry', 'Structure of Atom — Quantum Numbers & Orbitals', 5, 11),
      S('Chemistry', 'Structure of Atom — Electronic Configuration & Periodicity', 4, 9),
      S('Chemistry', 'Classification — Periodic Trends & Anomalies', 3, 8),
      S('Chemistry', 'Chemical Bonding — Lewis, VSEPR & Hybridization', 5, 11),
      S('Chemistry', 'Chemical Bonding — Molecular Orbital Theory & H-Bonding', 4, 9),
      S('Chemistry', 'Thermodynamics — Enthalpy, Entropy & Gibbs', 4, 10),
      S('Chemistry', 'Equilibrium — Chemical & Ionic (pH, Buffer)', 5, 12),
      S('Chemistry', 'Redox Reactions — Balancing & Electrode Potential', 3, 8),
      S('Chemistry', 'Hydrogen — Preparation & Uses', 2, 5),
      S('Chemistry', 's-Block Elements — Alkali & Alkaline Earth', 3, 8),
      S('Chemistry', 'p-Block — Boron & Carbon Family', 3, 8),
      S('Chemistry', 'Organic Basics — IUPAC & Isomerism', 4, 10),
      S('Chemistry', 'Organic Basics — Reaction Mechanisms (Substitution, Elimination)', 4, 10),
      S('Chemistry', 'Hydrocarbons — Alkanes, Alkenes, Alkynes', 4, 10),
      S('Chemistry', 'Hydrocarbons — Aromatic & Directing Effects', 4, 9),
      S('Chemistry', 'Environmental Chemistry — Pollution & Green Chemistry', 2, 5),
      S('Maths', 'Sets — Types & Operations & Venn Diagrams', 3, 7),
      S('Maths', 'Relations and Functions — Domain, Range & Types', 4, 9),
      S('Maths', 'Trigonometric Functions — Angles & Identities', 4, 10),
      S('Maths', 'Trigonometric Functions — Equations & General Solution', 4, 9),
      S('Maths', 'Complex Numbers — Algebra & Argand Plane', 4, 9),
      S('Maths', 'Complex Numbers — Quadratic Equations', 3, 7),
      S('Maths', 'Linear Inequalities — Graphical Solution', 3, 7),
      S('Maths', 'Permutations and Combinations — Counting & Applications', 5, 12),
      S('Maths', 'Binomial Theorem — General & Middle Term', 4, 9),
      S('Maths', 'Sequences and Series — AP, GP, HP & Sum', 5, 11),
      S('Maths', 'Straight Lines — Various Forms & Distance', 4, 10),
      S('Maths', 'Straight Lines — Family of Lines & Pair of Lines', 3, 8),
      S('Maths', 'Conic Sections — Circle & Parabola', 4, 10),
      S('Maths', 'Conic Sections — Ellipse & Hyperbola', 4, 10),
      S('Maths', '3D Geometry — Direction Cosines & Ratios', 3, 7),
      S('Maths', 'Limits — Standard Limits & L Hospital', 4, 9),
      S('Maths', 'Derivatives — First Principle & Chain Rule', 5, 11),
      S('Maths', 'Statistics — Mean, Variance & Standard Deviation', 3, 8),
      S('Maths', 'Probability — Conditional & Bayes', 4, 9),
      S('Biology', 'The Living World — Classification & Nomenclature', 3, 7),
      S('Biology', 'Biological Classification — Kingdoms & Viruses', 4, 9),
      S('Biology', 'Plant Kingdom — Algae to Angiosperms', 4, 10),
      S('Biology', 'Animal Kingdom — Non-chordates & Chordates', 4, 10),
      S('Biology', 'Morphology of Flowering Plants — Root, Stem, Leaf', 3, 8),
      S('Biology', 'Anatomy — Tissues & Secondary Growth', 3, 8),
      S('Biology', 'Cell Structure and Function — Organelles & Division', 5, 11),
      S('Biology', 'Biomolecules — Structure & Enzymes', 4, 9),
      S('Biology', 'Cell Cycle and Division — Mitosis & Meiosis', 4, 9),
      S('Biology', 'Photosynthesis — Light & Dark Reactions', 4, 10),
      S('Biology', 'Respiration in Plants — Glycolysis & ETS', 4, 9),
      S('Biology', 'Plant Growth and Development — Hormones', 3, 7),
      S('Biology', 'Breathing and Exchange of Gases', 4, 9),
      S('Biology', 'Body Fluids and Circulation — Heart & Blood', 4, 10),
      S('Biology', 'Excretory Products — Kidney & Regulation', 4, 9),
      S('Biology', 'Locomotion and Movement — Muscle & Skeletal', 3, 8),
      S('Biology', 'Neural Control and Coordination', 4, 9),
      S('Biology', 'Chemical Coordination — Hormones & Feedback', 4, 9),
      S('English', 'Reading Comprehension + Note-making', 3, 8),
      S('English', 'Hornbill — Prose: Portrait, We are Not Afraid, Discovering Tut, Landscape of Soul', 3, 9),
      S('English', 'Hornbill — Poetry: Photograph, Laburnum Top, Voice of Rain, Childhood, Father to Son', 3, 9),
      S('English', 'Snapshots — Summer, Address, Ranga, Albert Einstein, Mother Day', 3, 8),
      S('English', 'Writing — Letters, Reports, Speeches', 2, 7),
      S('Hindi', 'Aroh — Gadya: Namak Ka Daroga, Miyan Nasiruddin, Apu Ke Saath, Vidai Sambhashan', 3, 9),
      S('Hindi', 'Aroh — Padya: Kabir, Meera, Ghar Ki Yaad, Champa', 3, 8),
      S('Hindi', 'Vitan — Bhartiya Gaav, Vidya Sagar, Apu, etc.', 2, 7),
      S('Computer Science / AI', 'Python — Data Handling & File Handling', 4, 11),
      S('Computer Science / AI', 'Computer Systems & Networking Basics', 3, 8),
      S('Computer Science / AI', 'Intro to AI/ML — Supervised Learning Basics', 4, 10),
      S('History', 'Themes in World History — Early Societies to Nomadic Empires', 3, 9),
      S('Political Science', 'Indian Constitution at Work — Legislature, Executive, Judiciary', 4, 10),
      S('Geography', 'Fundamentals of Physical Geography — Geomorphic Processes', 3, 8),
      S('Economics', 'Statistics for Economics — Collection & Organization', 3, 8),
    ],
  },

  'Class 12': {
    key: 'class12',
    label: 'Class 12 · Full Syllabus (Science, Commerce, Humanities) — v1.0.6 expanded',
    rows: [
      S('Physics', 'Electric Charges and Fields — Coulomb & Gauss Law', 5, 12),
      S('Physics', 'Electric Potential — Potential & Capacitance', 5, 12),
      S('Physics', 'Current Electricity — Ohm Law, Kirchhoff & Wheatstone', 5, 12),
      S('Physics', 'Current Electricity — Potentiometer & Meter Bridge', 4, 9),
      S('Physics', 'Moving Charges — Biot-Savart & Ampere Law', 5, 11),
      S('Physics', 'Magnetism and Matter — Bar Magnet & Earth Magnetism', 3, 8),
      S('Physics', 'Electromagnetic Induction — Faraday & Lenz', 4, 10),
      S('Physics', 'Alternating Current — AC Circuits & Power', 4, 10),
      S('Physics', 'Electromagnetic Waves — Spectrum & Applications', 3, 7),
      S('Physics', 'Ray Optics — Mirrors, Refraction & TIR', 5, 12),
      S('Physics', 'Ray Optics — Prisms & Optical Instruments', 4, 10),
      S('Physics', 'Wave Optics — Interference & Diffraction & Polarization', 4, 10),
      S('Physics', 'Dual Nature — Photoelectric & de Broglie', 4, 9),
      S('Physics', 'Atoms — Bohr Model & Spectra', 3, 8),
      S('Physics', 'Nuclei — Mass Defect, Binding Energy & Decay', 4, 9),
      S('Physics', 'Semiconductor — Diodes, Transistors & Logic Gates', 4, 10),
      S('Physics', 'Communication Systems — Basics & Modulation', 2, 6),
      S('Chemistry', 'Solutions — Concentration & Colligative Properties', 4, 10),
      S('Chemistry', 'Electrochemistry — Nernst & Conductance', 5, 11),
      S('Chemistry', 'Chemical Kinetics — Rate Law & Arrhenius', 5, 11),
      S('Chemistry', 'Surface Chemistry — Adsorption & Colloids', 3, 7),
      S('Chemistry', 'p-Block — Group 15 to 18 Detailed', 4, 10),
      S('Chemistry', 'd- and f-Block — Properties & Lanthanides', 4, 10),
      S('Chemistry', 'Coordination Compounds — Nomenclature & Isomerism', 5, 11),
      S('Chemistry', 'Haloalkanes and Haloarenes — Substitution & Elimination', 4, 10),
      S('Chemistry', 'Alcohols, Phenols and Ethers — Preparation & Reactions', 4, 10),
      S('Chemistry', 'Aldehydes, Ketones — Nucleophilic Addition & Oxidation', 5, 11),
      S('Chemistry', 'Carboxylic Acids — Acidity & Derivatives', 4, 9),
      S('Chemistry', 'Amines — Basicity & Diazonium Salts', 4, 9),
      S('Chemistry', 'Biomolecules — Carbohydrates, Proteins, Nucleic Acids', 4, 10),
      S('Chemistry', 'Polymers — Types & Preparation', 3, 7),
      S('Chemistry', 'Chemistry in Everyday Life — Drugs & Detergents', 2, 6),
      S('Maths', 'Relations and Functions — Types & Composition', 4, 9),
      S('Maths', 'Inverse Trigonometry — Properties & Equations', 4, 9),
      S('Maths', 'Matrices — Operations & Applications', 4, 10),
      S('Maths', 'Determinants — Properties & Area', 5, 11),
      S('Maths', 'Continuity and Differentiability — Chain Rule & Implicit', 5, 12),
      S('Maths', 'Application of Derivatives — Tangents, Maxima-Minima', 5, 12),
      S('Maths', 'Integrals — Indefinite & Substitution', 5, 13),
      S('Maths', 'Integrals — Definite & Properties', 5, 12),
      S('Maths', 'Application of Integrals — Area Under Curve', 4, 10),
      S('Maths', 'Differential Equations — Formation & Solution', 4, 10),
      S('Maths', 'Vector Algebra — Dot, Cross & Triple Product', 4, 10),
      S('Maths', '3D Geometry — Line, Plane & Distance', 5, 12),
      S('Maths', 'Linear Programming — Graphical Method', 3, 7),
      S('Maths', 'Probability — Bayes & Random Variables', 5, 11),
      S('Biology', 'Reproduction in Organisms — Asexual & Sexual', 3, 8),
      S('Biology', 'Sexual Reproduction in Flowering Plants — Pollination & Fertilization', 4, 10),
      S('Biology', 'Human Reproduction — Gametogenesis & Pregnancy', 5, 12),
      S('Biology', 'Reproductive Health — Contraception & Infertility', 3, 8),
      S('Biology', 'Principles of Inheritance — Mendel & Chromosomal Theory', 5, 12),
      S('Biology', 'Molecular Basis — DNA, Replication, Transcription', 5, 13),
      S('Biology', 'Molecular Basis — Translation & Regulation', 4, 10),
      S('Biology', 'Evolution — Theories & Hardy-Weinberg', 4, 9),
      S('Biology', 'Human Health and Disease — Immunity & Diseases', 5, 11),
      S('Biology', 'Microbes in Human Welfare — Industrial & Sewage', 3, 8),
      S('Biology', 'Biotechnology Principles — Tools & Techniques', 4, 10),
      S('Biology', 'Biotechnology Applications — Transgenic & Gene Therapy', 4, 9),
      S('Biology', 'Organisms and Populations — Ecology & Adaptations', 3, 8),
      S('Biology', 'Ecosystem — Productivity & Energy Flow', 4, 9),
      S('Biology', 'Biodiversity and Conservation — Hotspots & Strategies', 4, 9),
      S('Biology', 'Environmental Issues — Pollution & Ozone', 3, 8),
      S('English', 'Flamingo — Prose: Last Lesson, Lost Spring, Deep Water, Rattrap, Indigo, Poets and Pancakes', 4, 11),
      S('English', 'Flamingo — Poetry: My Mother at Sixty-six, Keeping Quiet, Thing of Beauty, Roadside Stand, Aunt Jennifer', 4, 10),
      S('English', 'Vistas — Third Level, Tiger King, Journey to End of Earth, Enemy, On Face of It, Memories of Childhood', 4, 11),
      S('English', 'Writing — Notices, Letters, Articles, Reports', 3, 9),
      S('Hindi', 'Aroh — Gadya: Aatm Parichay, Patang, Kavitawali, Usha', 3, 9),
      S('Hindi', 'Aroh — Padya: Harivansh Rai, Alok Dhanwa, Kunwar Narayan', 3, 8),
      S('Hindi', 'Vitan — Silvar Wailing, Shirish Ke Phool, etc.', 2, 7),
      S('Computer Science / AI', 'Python — OOP, Stacks, Queues & File Handling', 4, 11),
      S('Computer Science / AI', 'Database Concepts & SQL', 3, 9),
      S('Computer Science / AI', 'Networking & Cyber Security Basics', 3, 8),
      S('History', 'Bricks, Beads and Bones + Kings, Farmers and Towns', 4, 10),
      S('History', 'Bhakti-Sufi Traditions + Vijayanagara Empire', 3, 9),
      S('History', 'Colonialism and Countryside + Rebels and Raj', 4, 10),
      S('History', 'Mahatma Gandhi and Nationalist Movement + Framing Constitution', 4, 10),
      S('Political Science', 'Contemporary World Politics — Cold War & US Hegemony', 4, 10),
      S('Political Science', 'Politics in India Since Independence — Emergency & Regional Aspirations', 4, 10),
      S('Geography', 'Fundamentals of Human Geography — Population & Migration', 3, 8),
      S('Geography', 'India People and Economy — Resources & Industries', 4, 10),
      S('Economics', 'Introductory Macroeconomics — National Income & Money Banking', 4, 10),
      S('Economics', 'Indian Economic Development — Reforms & Current Challenges', 3, 8),
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
  // FIX-B: College + Class 6-8 deleted per PO PDF — only 9-12 remain
  // Existing users who picked 6-8/College keep their rows — no DB deletion, but no new lookups
  const m = c.match(/class\s*(\d+)/) || c.match(/(\d{1,2})(st|nd|rd|th)/);
  const n = m ? parseInt(m[1], 10) : null;
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

