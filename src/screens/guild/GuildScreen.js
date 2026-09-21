// GUILD — friends, weekly leaderboard (resets Monday), activity
// feed with cheers, entry points to Daily Arena & Battles.
// Gamer mode. Cloud mode = real data; local mode = demo rivals.
// v1.0.6 recovery J: pending vs accepted, RLS accept, empty friend-ID guard
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { useAuth } from '../../context/AuthContext';
import { useGame } from '../../context/GameContext';
import { useTheme } from '../../context/ThemeContext';
import { GAMER, fonts, radius } from '../../config/theme';
import { db, isRemote } from '../../lib/db';
import { CLOUD_ONLY } from '../../config/constants';
import {
  DEMO_RIVALS, demoRivalWeeklyXp, demoFeed, syncMyWeeklyLeaderboard, tierFor,
} from '../../lib/guildData';
import { XPCounter, TierBadge } from '../../components/gamer/Badges';
import { PixelText } from '../../components/gamer/PixelText';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { ModalSheet } from '../../components/ui/ModalSheet';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Loading } from '../../components/ui/EmptyState';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { todayStr, weekStartStr, fmtDate, groupBy, nowIso } from '../../lib/utils';

export function GuildScreen({ navigation }) {
  useTheme('gamer');
  const { profile, updateProfile } = useAuth();
  const { awardXP, pushNotice } = useGame();
  const [tab, setTab] = useState('feed');
  const [loading, setLoading] = useState(true);
  const [weekRows, setWeekRows] = useState([]);
  const [friends, setFriends] = useState([]);
  const [incoming, setIncoming] = useState([]); // requests TO me (friend_id = me, pending)
  const [feed, setFeed] = useState([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addUsername, setAddUsername] = useState('');
  const [addMsg, setAddMsg] = useState('');
  const [qrOpen, setQrOpen] = useState(false);
  const [cheered, setCheered] = useState({});

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const mine = await syncMyWeeklyLeaderboard(profile);
      const weekStart = weekStartStr(todayStr());

      // ----- leaderboard ----- v1.0.6 J: guard empty in() filters
      const rows = [];
      if (mine) rows.push({ ...mine, name: profile.display_name || profile.username || 'You', emoji: '🫵', me: true });
      if (isRemote()) {
        const board = await db.list('leaderboard', { eq: { week_start: weekStart }, order: { col: 'total_xp', asc: false } });
        const ids = [...new Set(board.map((b) => b.user_id).filter((id) => id !== profile.id))];
        if (ids.length) {
          const users = await db.list('users', { in: { id: ids } });
          const byId = {};
          users.forEach((u) => (byId[u.id] = u));
          board
            .filter((b) => b.user_id !== profile.id)
            .forEach((b) =>
              rows.push({
                ...b,
                name: byId[b.user_id]?.display_name || byId[b.user_id]?.username || 'Player',
                emoji: '🎮',
              })
            );
        } else {
          // no other users — avoid empty in() query that would error in Supabase
          board
            .filter((b) => b.user_id !== profile.id)
            .forEach((b) => rows.push({ ...b, name: 'Player', emoji: '🎮' }));
        }
      } else {
        demoRivalWeeklyXp(todayStr()).forEach((r) =>
          rows.push({ ...r, name: r.display_name, emoji: r.emoji, demo: true })
        );
      }
      rows.sort((a, b) => b.total_xp - a.total_xp);
      rows.forEach((r, i) => (r.rank = i + 1));
      setWeekRows(rows);

      // ----- friends ----- v1.0.6 J: pending vs accepted separation + empty guard
      const fr = await db.list('friends', { eq: { user_id: profile.id } });
      // incoming requests TO me
      let inc = [];
      if (isRemote()) {
        try {
          inc = await db.list('friends', { eq: { friend_id: profile.id, status: 'pending' } });
        } catch { /* RLS should allow via friends_participants */ }
      }
      const incUserIds = inc.map((r) => r.user_id).filter(Boolean);
      const incUsers = incUserIds.length ? await db.list('users', { in: { id: incUserIds } }) : [];
      const incNameOf = {};
      incUsers.forEach((u) => (incNameOf[u.id] = { name: u.display_name || u.username || 'Player', username: u.username || 'player' }));
      setIncoming(inc.map((r) => ({ ...r, from: incNameOf[r.user_id] || { name: 'Player', username: 'player' } })));

      const acceptedFriends = fr.filter((f) => f.status === 'accepted');
      const pendingSent = fr.filter((f) => f.status === 'pending');

      // guard empty friend-id filters
      const friendIds = [...new Set(acceptedFriends.map((f) => f.friend_id).filter(Boolean))];
      let friendUsersById = {};
      if (friendIds.length) {
        try {
          const users = await db.list('users', { in: { id: friendIds } });
          users.forEach((u) => (friendUsersById[u.id] = u));
        } catch {
          friendUsersById = {};
        }
      }

      const demoFriends = fr.length || isRemote() || CLOUD_ONLY ? [] : DEMO_RIVALS.slice(0, 3).map((r) => ({ id: `demo-${r.id}`, friend: r, status: 'accepted', demo: true }));

      const mappedFriends = [
        ...acceptedFriends.map((f) => ({
          ...f,
          friend: {
            id: f.friend_id,
            display_name: friendUsersById[f.friend_id]?.display_name || f.friend_name || 'Player',
            username: friendUsersById[f.friend_id]?.username || f.friend_name || 'player',
            total_xp: friendUsersById[f.friend_id]?.total_xp || 0,
          },
        })),
        ...pendingSent.map((f) => ({
          ...f,
          friend: {
            id: f.friend_id,
            display_name: f.friend_name || 'Player',
            username: f.friend_name || 'player',
          },
          pendingSent: true,
        })),
        ...demoFriends,
      ];
      setFriends(mappedFriends);

      // ----- feed ----- only from accepted friends
      const items = [];
      if (isRemote()) {
        const events = await db.list('xp_events', { gte: { created_at: `${weekStart}T00:00:00` }, order: { col: 'created_at', asc: false }, limit: 40 });
        const acceptedIds = new Set(acceptedFriends.map((f) => f.friend_id).filter(Boolean));
        let nameOf = {};
        if (acceptedIds.size) {
          const ids = [...acceptedIds];
          if (ids.length) {
            try {
              const users = await db.list('users', { in: { id: ids } });
              users.forEach((u) => (nameOf[u.id] = u.display_name || u.username));
            } catch {
              nameOf = {};
            }
          }
        }
        events
          .filter((e) => acceptedIds.has(e.user_id) && e.user_id !== profile.id)
          .slice(0, 12)
          .forEach((e) => items.push({ id: e.id, text: `${nameOf[e.user_id] || 'A friend'} ${feedTextFor(e)}`, ts: e.created_at }));
      }
      if (!isRemote() && !items.length) items.push(...demoFeed(todayStr()).map((d) => ({ ...d, text: d.text, demo: true })));
      setFeed(items);
    } finally {
      setLoading(false);
    }
  }, [profile?.id, profile]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // accept / decline incoming requests — v1.0.6 J: RLS allows friend_id to update
  // FIX-F6 + FIX-F5: respondRequest with identity guard and visible error
  const respondRequest = async (row, accept) => {
    try {
      if (accept) {
        await db.update('friends', row.id, { status: 'accepted' });
        const existingMirror = await db.list('friends', { eq: { user_id: profile.id, friend_id: row.user_id } });
        if (!existingMirror.length) {
          await db.insert('friends', {
            user_id: profile.id,
            friend_id: row.user_id,
            friend_name: row.from?.name || 'Player',
            status: 'accepted',
            created_at: nowIso(),
          });
        }
      } else {
        await db.remove('friends', row.id);
      }
      await load();
    } catch (e) {
      console.warn('[F6] respondRequest failed', e?.message);
      if (String(e?.message||'').includes('Session expired')) {
        setAddMsg('Session expired — please login again');
      } else if (String(e?.message||'').includes('42501')) {
        setAddMsg('Request update failed — permission error, please re-login');
      } else {
        setAddMsg(e?.message || 'Request update nahi ho paya.');
      }
    }
  };

  // FIX-F6: silent failure audit — addFriend had no try/catch, UI unresponsive on RLS 42501
  const addFriend = async () => {
    const uname = addUsername.trim().replace(/^@/, '');
    if (!uname) return;
    setAddMsg('');
    if (uname.toLowerCase() === (profile?.username || '').toLowerCase()) {
      setAddMsg('Khud ko add karke kya milega yaar 😄');
      return;
    }
    try {
      if (isRemote()) {
        const found = await db.list('users', { eq: { username: uname } });
        if (!found.length) {
          setAddMsg('No player with that username. Spelling check karo!');
          return;
        }
        const already = await db.list('friends', { eq: { user_id: profile.id, friend_id: found[0].id } });
        if (already.length) {
          setAddMsg('Already friends / request pending hai.');
          return;
        }
        const reverse = await db.list('friends', { eq: { user_id: found[0].id, friend_id: profile.id } });
        if (reverse.length && reverse[0].status === 'pending') {
          setAddMsg('Unhone already request bheja hai — incoming requests check karo! 📨');
          return;
        }
        await db.insert('friends', {
          user_id: profile.id,
          friend_id: found[0].id,
          friend_name: found[0].display_name || found[0].username,
          status: 'pending',
          created_at: nowIso(),
        });
        setAddMsg('Request bhej di! Accept hone tak thoda patience 😄');
      } else {
        if (friends.some((f) => (f.friend?.username || '').toLowerCase() === uname.toLowerCase())) {
          setAddMsg('Already in your guild!');
          return;
        }
        await db.insert('friends', {
          user_id: profile.id,
          friend_id: `local-${uname}`,
          friend_name: uname,
          status: 'accepted',
          created_at: nowIso(),
        });
        setAddMsg(`${uname} added to your guild! 🎉`);
      }
      setAddUsername('');
      await load();
    } catch (e) {
      console.warn('[F6] addFriend failed', e?.message);
      // Friendly visible message, DB detail only in console
      if (String(e?.message||'').includes('Session expired')) {
        setAddMsg('Session expired — please login again');
      } else if (String(e?.message||'').includes('Session mismatch')) {
        setAddMsg('Session mismatch — reloading profile, please try again');
      } else if (String(e?.message||'').includes('42501') || String(e?.message||'').toLowerCase().includes('permission')) {
        setAddMsg('Friend request failed — permission error (RLS). Please re-login and try again.');
      } else {
        setAddMsg(e?.message || 'Friend request nahi ho paya — dobara try karo');
      }
    }
  };

  const cheer = (item) => {
    if (cheered[item.id]) return;
    setCheered((c) => ({ ...c, [item.id]: true }));
    pushNotice(`Cheer bhej diya! ${item.demo ? '(demo)' : '🎉'} — dost ka motivation +10`);
  };

  const setPrivacy = (privacy) => updateProfile({ privacy });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: GAMER.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
        <View style={{ flex: 1 }}>
          <PixelText size={12} color={GAMER.text} glow>
            GUILD HALL 🏆
          </PixelText>
          <Text style={{ fontFamily: fonts.body, fontSize: 12, color: GAMER.subtext, marginTop: 8 }}>
            {isRemote() ? 'Cloud mode — real rivals' : 'Local mode — demo rivals (add Supabase for real friends)'}
          </Text>
        </View>
        <Pressable onPress={() => setQrOpen(true)} hitSlop={8} style={{ backgroundColor: GAMER.surface, borderWidth: 1, borderColor: GAMER.border, borderRadius: 10, padding: 8, marginRight: 8 }}>
          <Ionicons name="qr-code-outline" size={20} color={GAMER.text} />
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', marginBottom: 14 }}>
        <View
          style={{
            flexDirection: 'row', alignItems: 'center',
            backgroundColor: isRemote() ? 'rgba(16,185,129,0.12)' : GAMER.surface,
            borderWidth: 1,
            borderColor: isRemote() ? '#10B981' : GAMER.border,
            borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
            marginRight: 8,
          }}
        >
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: isRemote() ? '#10B981' : '#64748B', marginRight: 6 }} />
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 11, color: isRemote() ? '#10B981' : GAMER.subtext }}>
            {isRemote() ? 'ONLINE MODE · real players' : 'LOCAL MODE · demo rivals shown'}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', marginBottom: 16 }}>
        <EntryCard
          icon="⚔️"
          title="DAILY ARENA"
          sub="Same 5 Qs · global rank · once per day"
          onPress={() => navigation.navigate('Arena')}
          color={GAMER.gold}
        />
        <EntryCard
          icon="🤺"
          title="BATTLE"
          sub="Challenge a friend"
          onPress={() => navigation.navigate('Battle')}
          color={GAMER.secondary}
        />
      </View>

      <SegmentedControl
        options={[
          { key: 'feed', label: 'Feed' },
          { key: 'leaderboard', label: 'Leaderboard' },
          { key: 'friends', label: 'Friends' },
        ]}
        value={tab}
        onChange={setTab}
        mode="gamer"
        style={{ marginBottom: 16 }}
      />

      {loading ? <Loading mode="gamer" text="Gathering the guild…" /> : null}

      {tab === 'feed' && !loading ? (
        <View>
          {!feed.length ? (
            <Card mode="gamer" style={{ alignItems: 'center', paddingVertical: 26 }}>
              <Text style={{ fontSize: 34, marginBottom: 8 }}>🤝</Text>
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: GAMER.text, textAlign: 'center' }}>
                {isRemote() ? 'No activity yet' : 'Nothing here yet'}
              </Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 12, color: GAMER.subtext, textAlign: 'center', marginTop: 6, lineHeight: 17 }}>
                {isRemote()
                  ? 'Invite your classmates — jab dost XP kamayenge, yahan dikhega. 👀'
                  : 'Complete a quest and the feed wakes up.'}
              </Text>
            </Card>
          ) : null}
          {feed.map((item) => (
            <Card key={item.id} mode="gamer" style={{ marginBottom: 10 }}>
              <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13.5, color: GAMER.text, lineHeight: 19 }}>{item.text}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
                <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: GAMER.subtext, flex: 1 }}>
                  {String(item.ts || '').slice(0, 16).replace('T', ' · ')}
                </Text>
                <Pressable onPress={() => cheer(item)} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ fontSize: 13, marginRight: 5 }}>{cheered[item.id] ? '🎉' : '👏'}</Text>
                  <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12, color: cheered[item.id] ? GAMER.accent : GAMER.subtext }}>
                    {cheered[item.id] ? 'Cheered!' : 'Cheer'}
                  </Text>
                </Pressable>
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      {tab === 'leaderboard' && !loading ? (
        <View>
          <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: GAMER.subtext, marginBottom: 12 }}>
            Week of {fmtDate(weekStartStr(todayStr()))} · resets every Monday
          </Text>
          {weekRows.map((row) => (
            <LeaderRow key={`${row.user_id}-${row.rank}`} row={row} />
          ))}
          <Card mode="gamer" style={{ marginTop: 6, backgroundColor: 'rgba(124,58,237,0.07)' }}>
            <Text style={{ fontFamily: fonts.body, fontSize: 11, color: GAMER.subtext, lineHeight: 17 }}>
              XP breakdown: 📖 study · ✅ habits · 💪 gym · 🤝 social. Week ke XP Sunday raat tak count hote hain!
            </Text>
          </Card>
        </View>
      ) : null}

      {tab === 'friends' && !loading ? (
        <View>
          <Button title="+ Add by username" variant="secondary" size="sm" mode="gamer" onPress={() => setAddOpen(true)} style={{ alignSelf: 'flex-start', marginBottom: 14 }} />

          <Card mode="gamer" style={{ marginBottom: 14 }}>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: GAMER.text, marginBottom: 8 }}>
              Privacy — kaun tumhe leaderboard pe dekh sakta hai?
            </Text>
            <View style={{ flexDirection: 'row' }}>
              {[
                { key: 'public', label: '🌍 Everyone' },
                { key: 'friends', label: '👥 Friends only' },
                { key: 'private', label: '🔒 Just me' },
              ].map((p) => (
                <Chip key={p.key} label={p.label} small selected={(profile?.privacy || 'friends') === p.key} onPress={() => setPrivacy(p.key)} mode="gamer" />
              ))}
            </View>
          </Card>

          {incoming.length ? (
            <>
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: GAMER.secondary, marginBottom: 8 }}>
                📨 Incoming requests ({incoming.length})
              </Text>
              {incoming.map((r) => (
                <Card key={r.id} mode="gamer" style={{ marginBottom: 10, borderColor: 'rgba(124,58,237,0.5)' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: 'rgba(124,58,237,0.15)', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                      <Text style={{ fontSize: 20 }}>🎮</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: GAMER.text }}>
                        {r.from?.name || 'Player'}
                      </Text>
                      <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: GAMER.subtext, marginTop: 2 }}>
                        @{r.from?.username || 'player'} wants to be your rival
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => respondRequest(r, false)}
                      hitSlop={6}
                      style={{ padding: 7, marginRight: 4, backgroundColor: 'rgba(239,68,68,0.12)', borderRadius: 10 }}
                    >
                      <Ionicons name="close" size={16} color="#EF4444" />
                    </Pressable>
                    <Pressable
                      onPress={() => respondRequest(r, true)}
                      hitSlop={6}
                      style={{ padding: 7, backgroundColor: 'rgba(16,185,129,0.15)', borderRadius: 10 }}
                    >
                      <Ionicons name="checkmark" size={17} color="#10B981" />
                    </Pressable>
                  </View>
                </Card>
              ))}
            </>
          ) : null}

          {friends.filter((f) => !f.pendingSent).length ? (
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12, color: GAMER.subtext, marginBottom: 8, marginTop: incoming.length ? 10 : 0 }}>
              ✅ Friends ({friends.filter((f) => !f.pendingSent && !f.demo).length})
            </Text>
          ) : null}
          {friends.filter((f) => !f.pendingSent).map((f, i) => (
            <Card key={f.id || i} mode="gamer" style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: 'rgba(124,58,237,0.15)', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                  <Text style={{ fontSize: 20 }}>{f.friend?.emoji || '🎮'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: GAMER.text }}>
                    {f.friend?.display_name || f.friend_name || 'Player'}
                  </Text>
                  <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: GAMER.subtext, marginTop: 2 }}>
                    @{f.friend?.username || f.friend_name || 'player'} · ✅ friends
                  </Text>
                </View>
                <TierBadge
                  tierName={tierFor(f.friend?.total_xp || 0).name}
                  xp={f.friend?.total_xp}
                  small
                />
              </View>
            </Card>
          ))}

          {friends.filter((f) => f.pendingSent).length ? (
            <>
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12, color: GAMER.subtext, marginBottom: 8, marginTop: 12 }}>
                ⏳ Pending sent ({friends.filter((f) => f.pendingSent).length})
              </Text>
              {friends.filter((f) => f.pendingSent).map((f, i) => (
                <Card key={`pend-${f.id || i}`} mode="gamer" style={{ marginBottom: 10, opacity: 0.7 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: 'rgba(100,116,139,0.15)', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                      <Text style={{ fontSize: 20 }}>⏳</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: GAMER.text }}>
                        {f.friend?.display_name || f.friend_name || 'Player'}
                      </Text>
                      <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: GAMER.subtext, marginTop: 2 }}>
                        @{f.friend?.username || f.friend_name || 'player'} · pending
                      </Text>
                    </View>
                  </View>
                </Card>
              ))}
            </>
          ) : null}

          {!friends.filter((f) => !f.demo).length && !incoming.length ? (
            <Card mode="gamer">
              <Text style={{ fontFamily: fonts.body, fontSize: 13, color: GAMER.subtext, textAlign: 'center', lineHeight: 19 }}>
                Koi dost nahi. Username se add karo — ya apna QR share karo! 🤝
              </Text>
            </Card>
          ) : null}
        </View>
      ) : null}

      <ModalSheet visible={addOpen} onClose={() => setAddOpen(false)} title="Add a Friend" mode="gamer">
        <Input label="Username" value={addUsername} onChangeText={setAddUsername} placeholder="arjun_grinds" mode="gamer" />
        {addMsg ? (
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: GAMER.secondary, marginBottom: 10, lineHeight: 18 }}>{addMsg}</Text>
        ) : null}
        <Button title="Send Request" mode="gamer" onPress={addFriend} disabled={!addUsername.trim()} />
        <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: GAMER.subtext, marginTop: 12, lineHeight: 17 }}>
          {isRemote()
            ? 'Cloud mode: request goes to a real account (they accept from their Guild tab).'
            : 'Local mode: friend list device pe store hoti hai. Supabase connect karo for real requests.'}
        </Text>
      </ModalSheet>

      <ModalSheet visible={qrOpen} onClose={() => setQrOpen(false)} title="My Guild QR" mode="gamer">
        <View style={{ alignItems: 'center', paddingVertical: 18 }}>
          <View style={{ backgroundColor: '#FFFFFF', padding: 18, borderRadius: 16 }}>
            <QRCode value={`studentos://player/${profile?.username || 'player'}`} size={180} color="#0D1117" />
          </View>
          <PixelText size={11} color={GAMER.text} style={{ marginTop: 18 }}>
            @{(profile?.username || 'player').toUpperCase()}
          </PixelText>
          <Text style={{ fontFamily: fonts.body, fontSize: 12, color: GAMER.subtext, marginTop: 10, textAlign: 'center', lineHeight: 17 }}>
            Dost se scan karwao — ya username bata do.{'\n'}Ek achha rival = ek achha rank. 😄
          </Text>
        </View>
      </ModalSheet>
    </ScrollView>
  );
}

function feedTextFor(e) {
  const map = {
    FOCUS_SESSION: `completed a focus session (+${e.amount} XP) 🎯`,
    STUDY_QUEST: 'completed a study quest 📚',
    CHAPTER_COMPLETE: 'conquered a chapter 🏆',
    HABIT: 'kept a habit streak alive ✅',
    WORKOUT: 'crushed a workout 💪',
    QUIZ_EXCELLENT: 'scored 90%+ on a quiz 🧠',
    ARENA_COMPLETE: 'finished the Daily Arena ⚔️',
  };
  return map[e.code] || `earned ${e.amount} XP ⚡`;
}

function LeaderRow({ row }) {
  const medal = row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : null;
  const isMe = row.me;
  return (
    <View
      style={{
        backgroundColor: isMe ? 'rgba(124,58,237,0.16)' : GAMER.surface,
        borderWidth: 1,
        borderColor: isMe ? GAMER.primarySoft : GAMER.border,
        borderRadius: radius.lg,
        padding: 12,
        marginBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <Text style={{ fontFamily: fonts.pixel, fontSize: 11, color: medal ? GAMER.gold : GAMER.subtext, width: 34 }}>
        {medal || `#${row.rank}`}
      </Text>
      <Text style={{ fontSize: 20, marginRight: 10 }}>{row.emoji || '🎮'}</Text>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: GAMER.text }}>
          {row.name} {isMe ? '(you)' : ''}
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: GAMER.subtext, marginTop: 2 }}>
          📖 {row.study_xp || 0} · ✅ {row.habit_xp || 0} · 💪 {row.gym_xp || 0} · 🤝 {row.social_xp || 0}
        </Text>
      </View>
      <XPCounter xp={row.total_xp || 0} size={13} />
    </View>
  );
}

function EntryCard({ icon, title, sub, onPress, color }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        backgroundColor: 'rgba(255,255,255,0.03)',
        borderWidth: 1,
        borderColor: color + '55',
        borderRadius: radius.lg,
        padding: 14,
        marginRight: 10,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ fontSize: 24, marginBottom: 8 }}>{icon}</Text>
      <PixelText size={9} color={color}>
        {title}
      </PixelText>
      <Text style={{ fontFamily: fonts.body, fontSize: 11, color: GAMER.subtext, marginTop: 7 }}>{sub}</Text>
    </Pressable>
  );
}
