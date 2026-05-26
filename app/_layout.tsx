import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { StatusBar, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { SafeAreaProvider } from "react-native-safe-area-context";
import TrackPlayer from "react-native-track-player";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ensureRtpSetup, PlayerProvider } from "@/context/PlayerContext";
import { PlaybackService } from "@/utils/PlaybackService";

// Register the RNTP background service — must be at module level
TrackPlayer.registerPlaybackService(() => PlaybackService);
// Avvia il setup RNTP subito, prima che qualsiasi componente venga montato
ensureRtpSetup();

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

const BG = "#1e1e26";

function RootLayoutNav() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: BG },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="browser"
        options={{
          headerShown: false,
          presentation: "card",
          animation: "slide_from_right",
          contentStyle: { backgroundColor: BG },
        }}
      />
      <Stack.Screen
        name="settings"
        options={{
          headerShown: false,
          presentation: "modal",
          animation: "slide_from_bottom",
          contentStyle: { backgroundColor: BG },
        }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return <View style={{ flex: 1, backgroundColor: BG }} />;
  }

  return (
    <SafeAreaProvider style={{ flex: 1, backgroundColor: BG }}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1, backgroundColor: BG }}>
            <PlayerProvider>
              <RootLayoutNav />
            </PlayerProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
