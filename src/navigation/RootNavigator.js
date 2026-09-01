// Root navigation — auth/onboarding gate + 5 gamer-mode bottom tabs.
import { ActivityIndicator, Text, View } from 'react-native';
import { StatusBar } from 'react-native';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../context/AuthContext';
import { useThemeMode } from '../context/ThemeContext';
import { useGame } from '../context/GameContext';
import { useFocus } from '../context/FocusContext';
import { GAMER, getTheme, fonts } from '../config/theme';
import { APP_NAME } from '../config/constants';
import { LevelUpOverlay, XPToastStack } from '../components/gamer/Overlays';
import { FocusShieldOverlay } from '../components/focus/ShieldOverlay';

import { AuthScreen } from '../screens/auth/AuthScreen';
import { OnboardingScreen } from '../screens/onboarding/OnboardingScreen';
import { HomeScreen } from '../screens/home/HomeScreen';
import { StudyHubScreen } from '../screens/study/StudyHubScreen';
import { SyllabusScreen } from '../screens/study/SyllabusScreen';
import { ScheduleScreen } from '../screens/study/ScheduleScreen';
import { DeadlinesScreen } from '../screens/study/DeadlinesScreen';
import { TutorScreen } from '../screens/study/TutorScreen';
import { FlashcardsScreen } from '../screens/study/FlashcardsScreen';
import { DeckScreen } from '../screens/study/DeckScreen';
import { QuizScreen } from '../screens/study/QuizScreen';
import { ContentScreen } from '../screens/study/ContentScreen';
import { TestBuilderScreen } from '../screens/study/TestBuilderScreen';
import { TopicDetailScreen } from '../screens/study/TopicDetailScreen';
import { FocusScreen } from '../screens/focus/FocusScreen';
import { FocusStatsScreen } from '../screens/focus/FocusStatsScreen';
import { LifeHubScreen } from '../screens/life/LifeHubScreen';
import { HabitsScreen } from '../screens/life/HabitsScreen';
import { GymScreen } from '../screens/life/GymScreen';
import { WisdomScreen } from '../screens/life/WisdomScreen';
import { GuildScreen } from '../screens/guild/GuildScreen';
import { ArenaScreen } from '../screens/guild/ArenaScreen';
import { BattleScreen } from '../screens/guild/BattleScreen';
import { SettingsScreen } from '../screens/settings/SettingsScreen';

const Tab = createBottomTabNavigator();
const HomeStack = createNativeStackNavigator();
const StudyStack = createNativeStackNavigator();
const FocusStack = createNativeStackNavigator();
const LifeStack = createNativeStackNavigator();
const GuildStack = createNativeStackNavigator();

const noHeader = { headerShown: false };

function HomeStackNav() {
  return (
    <HomeStack.Navigator screenOptions={noHeader}>
      <HomeStack.Screen name="HomeMain" component={HomeScreen} />
      <HomeStack.Screen name="Settings" component={SettingsScreen} />
    </HomeStack.Navigator>
  );
}

function StudyStackNav() {
  return (
    <StudyStack.Navigator screenOptions={noHeader}>
      <StudyStack.Screen name="StudyHub" component={StudyHubScreen} />
      <StudyStack.Screen name="Syllabus" component={SyllabusScreen} />
      <StudyStack.Screen name="TopicDetail" component={TopicDetailScreen} />
      <StudyStack.Screen name="Schedule" component={ScheduleScreen} />
      <StudyStack.Screen name="Deadlines" component={DeadlinesScreen} />
      <StudyStack.Screen name="Tutor" component={TutorScreen} />
      <StudyStack.Screen name="Flashcards" component={FlashcardsScreen} />
      <StudyStack.Screen name="Deck" component={DeckScreen} />
      <StudyStack.Screen name="Quiz" component={QuizScreen} />
      <StudyStack.Screen name="Content" component={ContentScreen} />
      <StudyStack.Screen name="TestBuilder" component={TestBuilderScreen} />
    </StudyStack.Navigator>
  );
}

function FocusStackNav() {
  return (
    <FocusStack.Navigator screenOptions={noHeader}>
      <FocusStack.Screen name="FocusMain" component={FocusScreen} />
      <FocusStack.Screen name="FocusStats" component={FocusStatsScreen} />
    </FocusStack.Navigator>
  );
}

function LifeStackNav() {
  return (
    <LifeStack.Navigator screenOptions={noHeader}>
      <LifeStack.Screen name="LifeHub" component={LifeHubScreen} />
      <LifeStack.Screen name="Habits" component={HabitsScreen} />
      <LifeStack.Screen name="Gym" component={GymScreen} />
      <LifeStack.Screen name="Wisdom" component={WisdomScreen} />
    </LifeStack.Navigator>
  );
}

function GuildStackNav() {
  return (
    <GuildStack.Navigator screenOptions={noHeader}>
      <GuildStack.Screen name="GuildMain" component={GuildScreen} />
      <GuildStack.Screen name="Arena" component={ArenaScreen} />
      <GuildStack.Screen name="Battle" component={BattleScreen} />
    </GuildStack.Navigator>
  );
}

const TABS = [
  { name: 'HomeTab', label: 'Home', icon: 'home', component: HomeStackNav },
  { name: 'StudyTab', label: 'Study', icon: 'book', component: StudyStackNav },
  { name: 'FocusTab', label: 'Focus', icon: 'timer', component: FocusStackNav },
  { name: 'LifeTab', label: 'Life', icon: 'barbell', component: LifeStackNav },
  { name: 'GuildTab', label: 'Guild', icon: 'trophy', component: GuildStackNav },
];

function MainTabs() {
  const insets = useSafeAreaInsets();
  const game = useGame();
  const focus = useFocus();
  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator
        screenListeners={({ route }) => ({
          // Focus Shield: softly intercept tab switches during a focus session
          tabPress: (e) => {
            if (route.name !== 'FocusTab' && focus.session && !focus.session.pausedAt) {
              e.preventDefault();
              focus.attemptDistraction(`switched to ${route.name.replace('Tab', '')}`);
            }
          },
        })}
      screenOptions={({ route }) => {
        const tab = TABS.find((t) => t.name === route.name);
        return {
          headerShown: false,
          tabBarActiveTintColor: GAMER.primarySoft,
          tabBarInactiveTintColor: GAMER.subtext,
          tabBarStyle: {
            backgroundColor: GAMER.surface,
            borderTopColor: GAMER.border,
            borderTopWidth: 1,
            height: 58 + insets.bottom,
            paddingBottom: insets.bottom + 6,
            paddingTop: 6,
          },
          tabBarLabelStyle: { fontFamily: fonts.bodySemiBold, fontSize: 10.5 },
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? tab.icon : `${tab.icon}-outline`}
              size={22}
              color={color}
              style={focused ? { textShadowColor: GAMER.primarySoft, textShadowRadius: 12, textShadowOffset: { width: 0, height: 0 } } : undefined}
            />
          ),
        };
      }}
    >
      {TABS.map((t) => (
        <Tab.Screen key={t.name} name={t.name} component={t.component} options={{ title: t.label }} />
      ))}
    </Tab.Navigator>
      <XPToastStack toasts={game.toasts} />
      <NoticeStack notices={game.notices} />
      <FocusShieldOverlay shield={focus.shield} onStay={focus.stayFocused} onLeave={focus.leaveAnyway} />
      <LevelUpOverlay celebration={game.celebration} onDone={game.dismissCelebration} />
    </View>
  );
}

function NoticeStack({ notices }) {
  if (!notices?.length) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', bottom: 92, left: 0, right: 0, alignItems: 'center' }}>
      {notices.map((n) => (
        <View
          key={n.id}
          style={{
            backgroundColor: 'rgba(13,17,23,0.94)',
            borderWidth: 1,
            borderColor: GAMER.secondary + '66',
            borderRadius: 999,
            paddingVertical: 8,
            paddingHorizontal: 16,
            marginBottom: 6,
          }}
        >
          <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: GAMER.secondary }}>{n.text}</Text>
        </View>
      ))}
    </View>
  );
}

function BootScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: GAMER.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 52 }}>🎓</Text>
      <Text style={{ fontFamily: fonts.pixel, fontSize: 13, color: GAMER.text, marginTop: 20 }}>
        {APP_NAME}
      </Text>
      <ActivityIndicator size="small" color={GAMER.secondary} style={{ marginTop: 18 }} />
    </View>
  );
}

function Root() {
  const { session, profile, loading } = useAuth();
  const { mode } = useThemeMode();
  const theme = getTheme(mode);

  if (loading) return <BootScreen />;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={mode === 'gamer' ? 'light-content' : 'dark-content'} />
      {!session ? (
        <AuthScreen />
      ) : !profile || !profile.onboarded ? (
        <OnboardingScreen />
      ) : (
        <MainTabs />
      )}
    </View>
  );
}

export function RootNavigator() {
  const { mode } = useThemeMode();
  const theme = getTheme(mode);
  const navTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: theme.bg,
      card: GAMER.surface,
      border: GAMER.border,
      text: GAMER.text,
      primary: GAMER.primary,
    },
  };
  return (
    <NavigationContainer theme={navTheme}>
      <Root />
    </NavigationContainer>
  );
}
