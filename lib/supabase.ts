import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import "react-native-url-polyfill/auto";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// Use a valid URL format for the placeholder to prevent the library from crashing the app process
const validUrl = supabaseUrl && supabaseUrl.startsWith("http") 
  ? supabaseUrl 
  : "https://placeholder-please-set-your-url.supabase.co";

const validKey = supabaseAnonKey || "placeholder-key";

export const supabase = createClient(validUrl, validKey, {
  auth: {
    storage: Platform.OS === "web" ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === "web",
  },
});
