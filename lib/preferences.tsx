import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

type PlateType = 20 | 25;

interface PreferencesContextType {
  plateType: PlateType;
  setPlateType: (type: PlateType) => void;
}

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [plateType, setPlateTypeState] = useState<PlateType>(20);

  useEffect(() => {
    AsyncStorage.getItem("user-plate-pref").then((value) => {
      if (value === "20" || value === "25") {
        setPlateTypeState(parseInt(value) as PlateType);
      }
    });
  }, []);

  const setPlateType = async (type: PlateType) => {
    setPlateTypeState(type);
    await AsyncStorage.setItem("user-plate-pref", type.toString());
  };

  return (
    <PreferencesContext.Provider value={{ plateType, setPlateType }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (context === undefined) {
    throw new Error("usePreferences must be used within a PreferencesProvider");
  }
  return context;
}
