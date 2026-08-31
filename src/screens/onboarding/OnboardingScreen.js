// Onboarding — 5 quick steps + "Building your quest…" + reveal.
// Skippable at every step; finish the rest later from Home.
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { GAMER, fonts, radius } from '../../config/theme';
import {
  CLASS_GROUPS, BOARDS, EXAMS, OLYMPIADS, PREP_LEVELS, STUDY_TIMES, WEEKDAYS, APP_NAME,
} from '../../config/constants';
import { Button } from '../../components/ui/Button';
import { Input, Stepper } from '../../components/ui/Input';
import { Chip } from '../../components/ui/Chip';
import { PixelText } from '../../components/gamer/PixelText';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { seedHabits, seedSyllabus } from '../../lib/starterData';
import { daysUntil } from '../../lib/utils';

const TOTAL_STEPS = 5;

export function OnboardingScreen() {
  const { profile, updateProfile, session } = useAuth();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0); // 0..4 = steps, 5 = building, 6 = reveal
  const [form, setForm] = useState({
    display_name: profile?.display_name || '',
    class_level: '',
    board: '',
    competitive_exam: 'None',
    exam_date: '',
    olympiad: 'None',
    olympiad_date: '',
    school_exams: [],

    daily_study_hours: 3,
    preferred_time: STUDY_TIMES[0],
    prep_level: PREP_LEVELS[1],
    days_off: [],
    commitments: '',
  });
  const [revealStats, setRevealStats] = useState({ topics: 0, habits: 0 });
  const [busy, setBusy] = useState(false);
  const [buildMsg, setBuildMsg] = useState(0);
  const spin = useRef(new Animated.Value(0)).current;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // "Building your quest…" spinner
  useEffect(() => {
    if (step !== 5) return;
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 900, useNativeDriver: true, easing: Easing.linear })
    );
    loop.start();
    const msgs = [
      'Mapping your syllabus…',
      'Setting up daily quests…',
      'Charging XP engine…',
      'Waking up Professor Byte… ☕',
    ];
    let i = 0;
    const msgTimer = setInterval(() => {
      i = (i + 1) % msgs.length;
      setBuildMsg(i);
    }, 700);
    const done = setTimeout(async () => {
      try {
        const topics = await seedSyllabus(profile.id, {
          class_level: form.class_level,
          board: form.board,
          competitive_exam: form.competitive_exam,
          olympiad: form.olympiad,
        });
        const habits = await seedHabits(profile.id);
        setRevealStats({ topics: topics || 0, habits: habits || 0 });
      } catch (e) {
        setRevealStats({ topics: 0, habits: 0 });
      }
      setStep(6);
    }, 2600);
    return () => {
      loop.stop();
      clearInterval(msgTimer);
      clearTimeout(done);
    };
  }, [step, spin, profile?.id, form.class_level, form.competitive_exam]);

  const finish = async () => {
    setBusy(true);
    try {
      const { _group, ...payload } = form;
      // clean school exams: keep only entries with a valid date
      const schoolExams = (form.school_exams || [])
        .map((e) => ({
          label: (e.label || 'School exam').trim() || 'School exam',
          exact: Boolean(e.exact),
          ...(e.exact
            ? { date: (e.date || '').trim() }
            : { start_date: (e.start_date || '').trim(), end_date: (e.end_date || e.start_date || '').trim() }),
        }))
        .filter((e) => (e.exact ? /^\d{4}-\d{2}-\d{2}$/.test(e.date || '') : /^\d{4}-\d{2}-\d{2}$/.test(e.start_date || '')));
      await updateProfile({
        ...payload,
        exam_date: form.exam_date || null,
        olympiad_date: form.olympiad_date || null,
        school_exams: schoolExams,
        days_off: form.days_off,
        onboarded: true,
      });
    } finally {
      setBusy(false);
    }
  };

  const next = () => setStep((s) => Math.min(6, s + 1));
  const skipAll = () => setStep(5);

  const setSchoolExam = (i, patch) => {
    setForm((f) => ({
      ...f,
      school_exams: (f.school_exams || []).map((e, j) => (j === i ? { ...e, ...patch } : e)),
    }));
  };

  const wrap = {
    flex: 1,
    backgroundColor: GAMER.bg,
    paddingTop: insets.top + 18,
    paddingHorizontal: 22,
  };

  // ---------- BUILDING ----------
  if (step === 5) {
    const rotation = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
    return (
      <View style={[wrap, { alignItems: 'center', justifyContent: 'center' }]}>
        <Animated.View style={{ transform: [{ rotate: rotation }] }}>
          <Text style={{ fontSize: 58 }}>🎓</Text>
        </Animated.View>
        <PixelText size={12} color={GAMER.text} style={{ marginTop: 30 }}>
          BUILDING YOUR QUEST…
        </PixelText>
        <Text style={{ fontFamily: fonts.body, fontSize: 14, color: GAMER.secondary, marginTop: 14 }}>
          {['Mapping your syllabus…', 'Setting up daily quests…', 'Charging XP engine…', 'Waking up Professor Byte… ☕'][buildMsg]}
        </Text>
      </View>
    );
  }

  // ---------- REVEAL ----------
  if (step === 6) {
    const dte = form.exam_date ? daysUntil(form.exam_date) : null;
    return (
      <View style={[wrap, { justifyContent: 'center' }]}>
        <View style={{ alignItems: 'center' }}>
          <PixelText size={11} color={GAMER.gold} glow>
            QUEST READY!
          </PixelText>
          <Text style={{ fontSize: 52, marginTop: 18 }}>⚔️</Text>
        </View>

        <View
          style={{
            backgroundColor: GAMER.surface,
            borderWidth: 1,
            borderColor: GAMER.border,
            borderRadius: radius.lg,
            padding: 20,
            marginTop: 26,
          }}
        >
          {[
            {
              icon: '📅',
              label: 'Days until exam',
              value: dte == null ? 'No exam — self-paced' : `${dte} days to go`,
            },
            {
              icon: '🗺️',
              label: 'Topics to conquer',
              value: revealStats.topics ? `${revealStats.topics} topics loaded` : 'Add from Study tab',
            },
            {
              icon: '⏰',
              label: 'Daily study hours',
              value: `${form.daily_study_hours} hrs · ${form.preferred_time.split(' (')[0]}`,
            },
            {
              icon: '✅',
              label: 'Habits unlocked',
              value: revealStats.habits ? `${revealStats.habits} starter habits` : 'Add from Life tab',
            },
          ].map((row) => (
            <View
              key={row.label}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: GAMER.card,
              }}
            >
              <Text style={{ fontSize: 22, marginRight: 14 }}>{row.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.body, fontSize: 12, color: GAMER.subtext }}>
                  {row.label}
                </Text>
                <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: GAMER.text, marginTop: 2 }}>
                  {row.value}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <Button title="Enter the Arena 🚀" onPress={finish} loading={busy} mode="gamer" pixel size="lg" style={{ marginTop: 26 }} />
        <Text
          style={{
            fontFamily: fonts.body,
            fontSize: 12,
            color: GAMER.subtext,
            textAlign: 'center',
            marginTop: 14,
          }}
        >
          Chalo shuru karte hain — welcome to {APP_NAME}!
        </Text>
      </View>
    );
  }

  // ---------- 5 STEPS ----------
  return (
    <View style={wrap}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
        <PixelText size={9} color={GAMER.subtext}>
          PLAYER SETUP {step + 1}/{TOTAL_STEPS}
        </PixelText>
        <View style={{ flex: 1 }} />
        {step < 4 ? (
          <Pressable onPress={skipAll} hitSlop={8}>
            <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: GAMER.secondary }}>Skip</Text>
          </Pressable>
        ) : null}
      </View>
      <ProgressBar progress={(step + 1) / TOTAL_STEPS} mode="gamer" color={GAMER.secondary} style={{ marginBottom: 20 }} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }}>
        {step === 0 && (
          <>
            <StepTitle emoji="👋" title="What should we call you?" />
            <Input
              mode="gamer"
              value={form.display_name}
              onChangeText={(v) => set({ display_name: v })}
              placeholder="e.g. Arjun"
              autoCapitalize="words"
              label="Your name"
              autoFocus
            />
            <InfoText>Your naam will show on quests and the leaderboard.</InfoText>
          </>
        )}

        {step === 1 && (
          <>
            <StepTitle emoji="🎒" title="Which class are you in?" />
            {CLASS_GROUPS.map((g) => (
              <CardGamer key={g.id} selected={form._group === g.id} onPress={() => set({ _group: g.id })}>
                <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: GAMER.text }}>{g.label}</Text>
                <Text style={{ fontFamily: fonts.body, fontSize: 12, color: GAMER.subtext, marginTop: 3 }}>
                  {g.hint}
                </Text>
              </CardGamer>
            ))}
            {form._group ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 }}>
                {(CLASS_GROUPS.find((g) => g.id === form._group)?.classes || []).map((c) => (
                  <Chip key={c} label={c} selected={form.class_level === c} onPress={() => set({ class_level: c })} mode="gamer" />
                ))}
              </View>
            ) : null}
            {CLASS_GROUPS.find((g) => g.id === form._group)?.showBoard ? (
              <View style={{ marginTop: 14 }}>
                <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: GAMER.subtext, marginBottom: 8 }}>
                  Board
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {BOARDS.map((b) => (
                    <Chip key={b} label={b} selected={form.board === b} onPress={() => set({ board: b })} mode="gamer" />
                  ))}
                </View>
              </View>
            ) : null}
          </>
        )}

        {step === 2 && (
          <>
            <StepTitle emoji="🎯" title="Prepping for a competitive exam?" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {EXAMS.map((x) => (
                <Chip key={x} label={x} selected={form.competitive_exam === x} onPress={() => set({ competitive_exam: x })} mode="gamer" />
              ))}
            </View>
            {form.competitive_exam !== 'None' ? (
              <View style={{ marginTop: 10 }}>
                <Input
                  mode="gamer"
                  label="Exam date (YYYY-MM-DD)"
                  value={form.exam_date}
                  onChangeText={(v) => set({ exam_date: v })}
                  placeholder="2027-05-24"
                  hint="AI uses this to auto-plan your deadlines. You can change it anytime."
                />
              </View>
            ) : null}
            <InfoText>Optional — 'None' bilkul fine hai, school padhai bhi game hai.</InfoText>
          </>
        )}

        {step === 3 && (
          <>
            <StepTitle emoji="🥇" title="Any olympiad on your radar?" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {OLYMPIADS.map((x) => (
                <Chip key={x} label={x} selected={form.olympiad === x} onPress={() => set({ olympiad: x })} mode="gamer" />
              ))}
            </View>
            {form.olympiad !== 'None' ? (
              <View style={{ marginTop: 10 }}>
                <Input
                  mode="gamer"
                  label="Olympiad date (YYYY-MM-DD)"
                  value={form.olympiad_date}
                  onChangeText={(v) => set({ olympiad_date: v })}
                  placeholder="2026-11-15"
                  hint="Optional — helps the scheduler plan around it."
                />
              </View>
            ) : null}

            <View style={{ marginTop: 18 }}>
              <StepTitle emoji="📅" title="School exam dates? (optional)" />
              <InfoText>
                Mid-terms, finals… add them and StudentOS will finish your CLASS syllabus ~2 weeks before each one.
              </InfoText>
              {(form.school_exams || []).map((e, i) => (
                <View key={i} style={{ marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Input
                        mode="gamer"
                        value={e.label}
                        onChangeText={(v) => setSchoolExam(i, { label: v })}
                        placeholder="e.g. Mid-Term"
                      />
                    </View>
                    <Pressable onPress={() => set({ school_exams: form.school_exams.filter((_, j) => j !== i) })} hitSlop={8} style={{ padding: 6, marginLeft: 4 }}>
                      <Ionicons name="close-circle" size={20} color="#94A3B8" />
                    </Pressable>
                  </View>
                  {e.exact ? (
                    <Input
                      mode="gamer"
                      value={e.date}
                      onChangeText={(v) => setSchoolExam(i, { date: v })}
                      placeholder="Exact date YYYY-MM-DD"
                      keyboardType="numeric"
                    />
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <View style={{ flex: 1, marginRight: 8 }}>
                        <Input
                          mode="gamer"
                          value={e.start_date}
                          onChangeText={(v) => setSchoolExam(i, { start_date: v })}
                          placeholder="From YYYY-MM-DD"
                          keyboardType="numeric"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Input
                          mode="gamer"
                          value={e.end_date}
                          onChangeText={(v) => setSchoolExam(i, { end_date: v })}
                          placeholder="To YYYY-MM-DD"
                          keyboardType="numeric"
                        />
                      </View>
                    </View>
                  )}
                  <Pressable
                    onPress={() => setSchoolExam(i, { exact: !e.exact })}
                    style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}
                    hitSlop={6}
                  >
                    <Ionicons name={e.exact ? 'checkbox' : 'square-outline'} size={15} color="#A78BFA" />
                    <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 11, color: '#C4B5FD', marginLeft: 6 }}>
                      Exact date pata hai
                    </Text>
                  </Pressable>
                </View>
              ))}
              <Pressable
                onPress={() => set({ school_exams: [...(form.school_exams || []), { label: '', start_date: '', end_date: '', exact: false }] })}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  alignSelf: 'flex-start',
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderRadius: 10,
                  backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.07)',
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.2)',
                  marginTop: 4,
                })}
              >
                <Ionicons name="add" size={16} color="#EDE9FE" />
                <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12.5, color: '#EDE9FE', marginLeft: 6 }}>
                  Add school exam
                </Text>
              </Pressable>
            </View>
          </>
        )}

        {step === 4 && (
          <>
            <StepTitle emoji="⚡" title="Quick setup — daily rhythm" />
            <Stepper
              mode="gamer"
              label="Daily study hours"
              value={form.daily_study_hours}
              onChange={(v) => set({ daily_study_hours: v })}
              min={0.5}
              max={14}
              step={0.5}
            />
            <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: GAMER.subtext, marginBottom: 8 }}>
              Best study time
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {STUDY_TIMES.map((t) => (
                <Chip key={t} label={t} selected={form.preferred_time === t} onPress={() => set({ preferred_time: t })} mode="gamer" small />
              ))}
            </View>
            <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: GAMER.subtext, marginVertical: 8 }}>
              Prep level
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {PREP_LEVELS.map((p) => (
                <Chip key={p} label={p} selected={form.prep_level === p} onPress={() => set({ prep_level: p })} mode="gamer" small />
              ))}
            </View>
            <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: GAMER.subtext, marginVertical: 8 }}>
              Days off (breaks are part of the plan)
            </Text>
            <View style={{ flexDirection: 'row' }}>
              {WEEKDAYS.map((d, i) => (
                <Chip
                  key={d}
                  label={d}
                  small
                  selected={form.days_off.includes(i)}
                  onPress={() =>
                    set({
                      days_off: form.days_off.includes(i)
                        ? form.days_off.filter((x) => x !== i)
                        : [...form.days_off, i],
                    })
                  }
                  mode="gamer"
                />
              ))}
            </View>
            <Input
              mode="gamer"
              label="Other commitments (optional)"
              value={form.commitments}
              onChangeText={(v) => set({ commitments: v })}
              placeholder="School 8am-2pm, coaching Mon/Wed 5pm…"
              multiline
            />
          </>
        )}
      </ScrollView>

      <View style={{ paddingBottom: insets.bottom + 10 }}>
        <Button
          title={step === 4 ? 'Build My Quest ⚔️' : 'Next'}
          pixel
          mode="gamer"
          onPress={() => (step === 4 ? setStep(5) : next())}
          disabled={step === 1 && !form.class_level}
          size="lg"
        />
      </View>
    </View>
  );
}

function StepTitle({ emoji, title }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
      <Text style={{ fontSize: 30, marginRight: 12 }}>{emoji}</Text>
      <PixelText size={12} color={GAMER.text}>
        {title.toUpperCase()}
      </PixelText>
    </View>
  );
}

function InfoText({ children }) {
  return (
    <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: GAMER.subtext, lineHeight: 18, marginTop: 4 }}>
      {children}
    </Text>
  );
}

function CardGamer({ children, selected, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: selected ? 'rgba(124,58,237,0.16)' : GAMER.surface,
        borderWidth: 1.5,
        borderColor: selected ? GAMER.primarySoft : GAMER.border,
        borderRadius: radius.lg,
        padding: 14,
        marginBottom: 10,
      }}
    >
      {children}
    </Pressable>
  );
}
