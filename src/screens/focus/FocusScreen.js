// FOCUS — Pomodoro timer (25/5, 15/3, 90/20, custom) with smooth
// circular progress ring, ambient sounds, session dots and
// reflection prompts. Light, calm mode.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useFocus } from '../../context/FocusContext';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { Screen } from '../../components/ui/Screen';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { Input } from '../../components/ui/Input';
import { ModalSheet } from '../../components/ui/ModalSheet';
import { SectionTitle } from '../../components/ui/EmptyState';
import { db } from '../../lib/db';
import { FOCUS_MODES } from '../../config/constants';
import { ambient, AMBIENT_SOUNDS } from '../../lib/soundService';
import { fonts, radius } from '../../config/theme';
import { todayStr, fmtClock, fmtDuration, localDateOf, dayjs } from '../../lib/utils';

const RING_SIZE = 252;
const STROKE = 14;
const R = (RING_SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

export function FocusScreen({ navigation }) {
  const focus = useFocus();
  const { profile } = useAuth();
  const settings = useSettings();
  const session = focus.session;

  const [modeKey, setModeKey] = useState('classic');
  const [customFocus, setCustomFocus] = useState('30');
  const [customBreak, setCustomBreak] = useState('5');
  const [topic, setTopic] = useState('');
  const [now, setNow] = useState(Date.now());
  const [ambientId, setAmbientId] = useState(null);
  const [volume, setVolume] = useState(settings.ambientVolume ?? 0.6);
  const [todayStats, setTodayStats] = useState({ minutes: 0, sessions: 0 });
  const [rating, setRating] = useState(3);
  const [note, setNote] = useState('');

  // ticking clock for the ring
  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [session?.id, session]);

  const loadToday = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const today = todayStr();
      const rows = await db.list('focus_sessions', {
        eq: { user_id: profile.id },
        gte: { start_time: `${today}T00:00:00` },
        lte: { start_time: `${today}T23:59:59` },
      });
      const todays = rows.filter((r) => String(r.start_time || '').slice(0, 10) === today);
      setTodayStats({
        minutes: todays.reduce((a, r) => a + (r.duration_minutes || 0), 0),
        sessions: todays.length,
      });
    } catch {
      /* ignore */
    }
  }, [profile?.id]);

  useFocusEffect(useCallback(() => { loadToday(); }, [loadToday]));

  const { remaining, total, progress } = useMemo(() => {
    if (!session) return { remaining: 0, total: 0, progress: 0 };
    const totalMs = (session.phase === 'focus' ? session.focusMinutes : session.breakMinutes) * 60000;
    const ref = session.pausedAt ? new Date(session.pausedAt).getTime() : now;
    const rem = Math.max(0, new Date(session.endsAt).getTime() - ref);
    return { remaining: rem, total: totalMs, progress: totalMs ? 1 - rem / totalMs : 0 };
  }, [session, now]);

  const startSession = () => {
    const cfg = FOCUS_MODES[modeKey];
    const f = modeKey === 'custom' ? Math.max(1, Number(customFocus) || 30) : cfg.focus;
    const b = modeKey === 'custom' ? Math.max(1, Number(customBreak) || 5) : cfg.break;
    focus.start({ mode: modeKey, focusMinutes: f, breakMinutes: b, topic });
    loadToday();
  };

  const toggleAmbient = (id) => {
    if (ambientId === id) {
      ambient.stop();
      setAmbientId(null);
    } else {
      ambient.play(id, volume);
      setAmbientId(id);
    }
  };

  const changeVolume = (delta) => {
    const v = Math.min(1, Math.max(0, +(volume + delta).toFixed(2)));
    setVolume(v);
    ambient.setVolume(v);
    settings.update({ ambientVolume: v });
  };

  // ---------------- active session UI ----------------
  if (session) {
    const isFocus = session.phase === 'focus';
    const accent = isFocus ? '#0891B2' : '#10B981';
    return (
      <Screen mode="light" scroll={false}>
        <ReflectionModal focus={focus} rating={rating} setRating={setRating} note={note} setNote={setNote} />
        {/* 20-min empathetic quote — small, dismissible, never preachy */}
        {focus.quote ? (
          <View
            style={{
              alignSelf: 'stretch',
              backgroundColor: '#ECFEFF',
              borderWidth: 1,
              borderColor: '#A5F3FC',
              borderRadius: radius.md,
              padding: 12,
              marginBottom: 12,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 16, marginRight: 10 }}>💚</Text>
            <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 12.5, color: '#0E7490', lineHeight: 18 }}>
              {focus.quote.text}
            </Text>
            <Pressable onPress={focus.dismissQuote} hitSlop={8} style={{ padding: 6 }}>
              <Ionicons name="close" size={16} color="#0891B2" />
            </Pressable>
          </View>
        ) : null}
        <View style={{ alignItems: 'center', flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <Text style={{ fontSize: 20, marginRight: 8 }}>{isFocus ? '🎯' : '☕'}</Text>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: accent }}>
              {isFocus ? 'Focus phase' : 'Break — saans lo'}
            </Text>
          </View>
          {session.topic ? (
            <Text numberOfLines={1} style={{ fontFamily: fonts.body, fontSize: 13, color: '#64748B', marginBottom: 4 }}>
              {session.topic}
            </Text>
          ) : null}

          {/* ring */}
          <View style={{ marginTop: 18 }}>
            <Svg width={RING_SIZE} height={RING_SIZE}>
              <Circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={R} stroke="#E2E8F0" strokeWidth={STROKE} fill="none" />
              <Circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={R}
                stroke={accent}
                strokeWidth={STROKE}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={CIRC}
                strokeDashoffset={CIRC * (1 - Math.min(1, Math.max(0, progress)))}
                transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
              />
            </Svg>
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontFamily: fonts.bodyBold, fontSize: 52, color: '#1E293B', fontVariant: ['tabular-nums'] }}>
                {fmtClock(remaining / 1000)}
              </Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: '#64748B', marginTop: 6 }}>
                {session.pausedAt ? 'Paused' : isFocus ? 'Deep work mode' : 'Recharge mode'}
              </Text>
            </View>
          </View>

          {/* session dots */}
          <View style={{ flexDirection: 'row', marginTop: 18 }}>
            {[0, 1, 2, 3].map((i) => (
              <View
                key={i}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  marginHorizontal: 5,
                  backgroundColor: i < session.cycles ? '#0891B2' : '#E2E8F0',
                }}
              />
            ))}
          </View>
          <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: '#94A3B8', marginTop: 8 }}>
            {session.cycles} session{session.cycles === 1 ? '' : 's'} done today · {session.distractions} distraction
            {session.distractions === 1 ? '' : 's'} blocked
          </Text>

          {/* controls */}
          <View style={{ flexDirection: 'row', marginTop: 22 }}>
            <BigControl
              icon={session.pausedAt ? 'play' : 'pause'}
              label={session.pausedAt ? 'Resume' : 'Pause'}
              onPress={session.pausedAt ? focus.resume : focus.pause}
            />
            <BigControl icon="stop" label="End" danger onPress={() => focus.stopSession()} />
            <BigControl icon="play-skip-forward" label="Skip" onPress={focus.skipPhase} />
          </View>

          {/* ambient quick row */}
          <View style={{ flexDirection: 'row', marginTop: 24 }}>
            {AMBIENT_SOUNDS.map((s) => (
              <Chip key={s.id} label={`${s.icon}`} selected={ambientId === s.id} onPress={() => toggleAmbient(s.id)} mode="light" small />
            ))}
            <Chip label="🔇" selected={!ambientId} onPress={() => { ambient.stop(); setAmbientId(null); }} mode="light" small />
          </View>
        </View>
      </Screen>
    );
  }

  // ---------------- setup UI ----------------
  return (
    <Screen mode="light">
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 22, color: '#1E293B' }}>Focus Timer</Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 13, color: '#64748B', marginTop: 3 }}>
            Shuru karo — ek session, ek quest. 🎯
          </Text>
        </View>
        <Pressable
          onPress={() => navigation.navigate('FocusStats')}
          style={({ pressed }) => ({
            backgroundColor: '#F1F5F9',
            borderWidth: 1,
            borderColor: '#E2E8F0',
            borderRadius: 10,
            padding: 8,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name="stats-chart-outline" size={20} color="#0891B2" />
        </Pressable>
      </View>

      {/* today summary */}
      <Card mode="light" style={{ marginBottom: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontSize: 26, marginRight: 12 }}>⏱️</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: '#1E293B' }}>
              Today: {fmtDuration(todayStats.minutes)} focused
            </Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B', marginTop: 2 }}>
              {todayStats.sessions} session{todayStats.sessions === 1 ? '' : 's'} · each minute = 1 XP
            </Text>
          </View>
        </View>
      </Card>

      <SectionTitle mode="light">Pick your mode</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Object.entries(FOCUS_MODES).map(([key, m]) => (
          <Chip key={key} label={`${m.label}`} selected={modeKey === key} onPress={() => setModeKey(key)} mode="light" />
        ))}
      </View>
      <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B', marginTop: 2, marginBottom: 14 }}>
        {FOCUS_MODES[modeKey].hint}
      </Text>

      {modeKey === 'custom' ? (
        <View style={{ flexDirection: 'row' }}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Input label="Focus minutes" value={customFocus} onChangeText={setCustomFocus} keyboardType="numeric" />
          </View>
          <View style={{ flex: 1 }}>
            <Input label="Break minutes" value={customBreak} onChangeText={setCustomBreak} keyboardType="numeric" />
          </View>
        </View>
      ) : null}

      <Input label="What are you studying? (optional)" value={topic} onChangeText={setTopic} placeholder="e.g. Thermodynamics revision" autoCapitalize="words" />

      <Button title="Start Focus Session ⚡" onPress={startSession} mode="light" size="lg" style={{ marginBottom: 20 }} />

      <SectionTitle mode="light">Ambient sounds</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {AMBIENT_SOUNDS.map((s) => (
          <Chip key={s.id} label={`${s.icon} ${s.label}`} selected={ambientId === s.id} onPress={() => toggleAmbient(s.id)} mode="light" />
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
        <Pressable onPress={() => changeVolume(-0.1)} style={volBtn}><Ionicons name="remove" size={18} color="#64748B" /></Pressable>
        <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: '#1E293B', marginHorizontal: 14 }}>
          Volume {Math.round(volume * 100)}%
        </Text>
        <Pressable onPress={() => changeVolume(0.1)} style={volBtn}><Ionicons name="add" size={18} color="#64748B" /></Pressable>
      </View>

      <Card mode="light" style={{ marginTop: 20, backgroundColor: '#F8FAFC' }}>
        <Text style={{ fontFamily: fonts.body, fontSize: 12, color: '#64748B', lineHeight: 18 }}>
          🛡️ Focus Shield ON during sessions: agar tum app switch karoge, ek friendly shield rok ke manayega (30-second
          wait + distraction log). Hard block nahi — bas pyaar bhara nudge.
        </Text>
      </Card>
    </Screen>
  );
}

function ReflectionModal({ focus, rating, setRating, note, setNote }) {
  const reflection = focus.reflection;
  useEffect(() => {
    if (reflection) {
      setRating(3);
      setNote('');
    }
  }, [reflection?.rowId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!reflection) return null;
  return (
    <ModalSheet visible={!!reflection} onClose={() => focus.dismissReflection(false)} title="Session done — kaisa laga?" mode="light">
      <Text style={{ fontFamily: fonts.body, fontSize: 13.5, color: '#475569', lineHeight: 19, marginBottom: 14 }}>
        {reflection.minutes} minutes of deep work — shaabaash! 🎉 Rate your focus (1–5) and leave a small note. XP milne wala hai.
      </Text>
      <View style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: 16 }}>
        {[1, 2, 3, 4, 5].map((v) => (
          <Pressable key={v} onPress={() => setRating(v)} style={{ marginHorizontal: 8 }}>
            <Text style={{ fontSize: 30, opacity: rating >= v ? 1 : 0.25 }}>
              {v <= 2 ? '😵' : v === 3 ? '😐' : v === 4 ? '🙂' : '🔥'}
            </Text>
          </Pressable>
        ))}
      </View>
      <Input label="Reflection (optional)" value={note} onChangeText={setNote} placeholder="Aaj focus accha tha, phone door rakhna padega…" multiline />
      <Button title={`Claim ${reflection.minutes} XP ⚡`} onPress={() => focus.submitReflection({ rating, note })} mode="light" />
      <Pressable onPress={() => focus.dismissReflection(false)} style={{ marginTop: 12, alignSelf: 'center' }}>
        <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12.5, color: '#94A3B8' }}>Skip note, just give XP</Text>
      </Pressable>
    </ModalSheet>
  );
}

function BigControl({ icon, label, onPress, danger }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: 'center',
        marginHorizontal: 14,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 58,
          height: 58,
          borderRadius: 29,
          backgroundColor: danger ? '#FEF2F2' : '#F1F5F9',
          borderWidth: 1.5,
          borderColor: danger ? '#FECACA' : '#E2E8F0',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={24} color={danger ? '#DC2626' : '#0891B2'} />
      </View>
      <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 11.5, color: '#64748B', marginTop: 7 }}>{label}</Text>
    </Pressable>
  );
}

const volBtn = {
  backgroundColor: '#F1F5F9',
  borderWidth: 1,
  borderColor: '#E2E8F0',
  borderRadius: 8,
  padding: 6,
};
