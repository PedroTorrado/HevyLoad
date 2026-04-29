import React, { createContext, useContext, useEffect, useState } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const Colors = {
  light: {
    background: "#FFFFFF",
    secondaryBackground: "#F9F9F9",
    card: "#F8F8F8",
    text: "#000000",
    secondaryText: "#888888",
    accentText: "#AAA",
    border: "#EEEEEE",
    primary: "#000000",
    secondary: "#F0F0F0",
    error: "#FF3B30",
    success: "#4CD964",
    tint: "#007AFF",
  },
  dark: {
    background: "#000000",
    secondaryBackground: "#121212",
    card: "#1C1C1E",
    text: "#FFFFFF",
    secondaryText: "#A0A0A0",
    accentText: "#666",
    border: "#2C2C2E",
    primary: "#FFFFFF",
    secondary: "#2C2C2E",
    error: "#FF453A",
    success: "#32D74B",
    tint: "#0A84FF",
  },
};

type ThemeMode = "light" | "dark" | "auto";

interface ThemeContextType {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  colors: typeof Colors.light;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>("auto");
  const systemScheme = useColorScheme() ?? "light";

  useEffect(() => {
    // Load persisted theme
    AsyncStorage.getItem("user-theme").then((value) => {
      if (value === "light" || value === "dark" || value === "auto") {
        setThemeModeState(value);
      }
    });
  }, []);

  const setThemeMode = async (mode: ThemeMode) => {
    setThemeModeState(mode);
    await AsyncStorage.setItem("user-theme", mode);
  };

  const isDark = themeMode === "auto" ? systemScheme === "dark" : themeMode === "dark";
  const colors = isDark ? Colors.dark : Colors.light;

  return (
    <ThemeContext.Provider value={{ themeMode, setThemeMode, colors, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

// Keeping this for backward compatibility if needed, but useTheme is preferred
export function useThemeColor() {
  const { colors } = useTheme();
  return colors;
}
