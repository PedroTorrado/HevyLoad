import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../../lib/supabase";
import { useThemeColor } from "../../../lib/theme";
import { usePreferences } from "../../../lib/preferences";
import { useFocusEffect } from "expo-router";
import { format, parseISO } from "date-fns";
import * as Haptics from "expo-haptics";
import { LineChart, BarChart } from "react-native-gifted-charts";

interface Exercise {
  id: string;
  name: string;
  muscle_group: string | null;
}

interface Set {
  id: string;
  weight_kg: number;
  reps: number;
  start_time: string;
  workout_id: string;
}

export default function ExerciseDetails() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useThemeColor();

  const [loading, setLoading] = useState(true);
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [sets, setSets] = useState<Set[]>([]);
  const [stats, setStats] = useState({
    oneRM: 0,
    bestSet: { weight: 0, reps: 0 },
    totalSets: 0,
    maxWeight: 0,
  });

  const [timeSpan, setTimeSpan] = useState<"1m" | "6m" | "1y" | "all">("all");

  const [isFeatured, setIsFeatured] = useState(false);
  const [chartType, setChartType] = useState<"line" | "bar">("line");
  const [xAxisType, setXAxisType] = useState<"date" | "reps" | "weight">(
    "date",
  );
  const [yAxisType, setYAxisType] = useState<
    "weight" | "reps" | "1rm" | "volume"
  >("1rm");
  const [showTopSetsOnly, setShowTopSetsOnly] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [activePointerItem, setActivePointerItem] = useState<any>(null);

  useFocusEffect(
    useCallback(() => {
      loadExerciseData();
    }, [id]),
  );

  async function loadExerciseData() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const [exRes, profileRes] = await Promise.all([
      supabase.from("exercises").select("*").eq("id", id).single(),
      supabase
        .from("profiles")
        .select("featured_exercise_ids")
        .eq("id", user.id)
        .single(),
    ]);

    if (exRes.data) {
      setExercise(exRes.data);
      if (profileRes.data) {
        const featured = (profileRes.data.featured_exercise_ids || []).includes(
          id as string,
        );
        setIsFeatured(featured);
      }
    }

    let allSetsData: any[] = [];
    let rangeStart = 0;
    const rangeStep = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data: setsData, error } = await supabase
        .from("sets")
        .select("id, weight_kg, reps, workout_id, workouts!inner(start_time)")
        .eq("exercise_id", id)
        .range(rangeStart, rangeStart + rangeStep - 1)
        .order("id", { ascending: true });

      if (error) {
        console.error("Error fetching sets:", error);
        break;
      }

      if (setsData && setsData.length > 0) {
        allSetsData = [...allSetsData, ...setsData];
        if (setsData.length < rangeStep) {
          hasMore = false;
        } else {
          rangeStart += rangeStep;
        }
      } else {
        hasMore = false;
      }
    }

    if (allSetsData.length > 0) {
      let formattedSets: Set[] = allSetsData.map((s: any) => ({
        id: s.id,
        weight_kg: s.weight_kg || 0,
        reps: s.reps || 0,
        workout_id: s.workout_id,
        start_time: s.workouts.start_time,
      }));

      formattedSets.sort(
        (a, b) =>
          new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
      );
      setSets(formattedSets);

      let max1RM = 0;
      let bestWeight = 0;
      let bestReps = 0;

      formattedSets.forEach((s) => {
        const weight = s.weight_kg;
        const reps = s.reps;
        const oneRM = reps === 1 ? weight : weight / (1.0278 - 0.0278 * reps);

        if (oneRM > max1RM) max1RM = oneRM;
        if (weight > bestWeight) {
          bestWeight = weight;
          bestReps = reps;
        }
      });

      setStats({
        oneRM: Math.round(max1RM * 10) / 10,
        bestSet: { weight: bestWeight, reps: bestReps },
        totalSets: formattedSets.length,
        maxWeight: bestWeight,
      });
    }

    setLoading(false);
  }

  const prMilestones = useMemo(() => {
    if (sets.length === 0) return [];
    const seenCombos = new Set<string>();
    const milestones: any[] = [];

    sets.forEach((s) => {
      const comboKey = `${s.weight_kg}x${s.reps}`;
      if (seenCombos.has(comboKey)) return;
      const oneRM =
        s.reps === 1 ? s.weight_kg : s.weight_kg / (1.0278 - 0.0278 * s.reps);
      milestones.push({
        date: s.start_time,
        weight: s.weight_kg,
        reps: s.reps,
        oneRM: Math.round(oneRM * 10) / 10,
        workout_id: s.workout_id,
      });
      seenCombos.add(comboKey);
    });

    return milestones.sort((a, b) => b.oneRM - a.oneRM);
  }, [sets]);

  const dynamicChartData = useMemo(() => {
    if (sets.length === 0) return [];

    const prMap: Record<string, { is1RM: boolean; isWT: boolean }> = {};
    let runMax1RM = 0;
    let runMaxWT = 0;

    // Calculate all-time PRs chronologically
    sets.forEach((s) => {
      const oneRM =
        s.reps === 1 ? s.weight_kg : s.weight_kg / (1.0278 - 0.0278 * s.reps);
      const weight = s.weight_kg;
      let is1RM = false;
      let isWT = false;
      if (oneRM > runMax1RM) {
        runMax1RM = oneRM;
        is1RM = true;
      }
      if (weight > runMaxWT) {
        runMaxWT = weight;
        isWT = true;
      }
      prMap[s.id] = { is1RM, isWT };
    });

    let filtered = [...sets];
    if (xAxisType === "date" && timeSpan !== "all") {
      const cutoff = new Date();
      if (timeSpan === "1m") cutoff.setMonth(cutoff.getMonth() - 1);
      else if (timeSpan === "6m") cutoff.setMonth(cutoff.getMonth() - 6);
      else if (timeSpan === "1y") cutoff.setFullYear(cutoff.getFullYear() - 1);
      filtered = filtered.filter((s) => new Date(s.start_time) >= cutoff);
    }

    if (showTopSetsOnly && xAxisType === "date") {
      const groups: Record<string, Set> = {};
      filtered.forEach((s) => {
        const d = format(parseISO(s.start_time), "yyyy-MM-dd");
        const getV = (set: Set) => {
          if (yAxisType === "1rm")
            return set.reps === 1
              ? set.weight_kg
              : set.weight_kg / (1.0278 - 0.0278 * set.reps);
          if (yAxisType === "weight") return set.weight_kg;
          if (yAxisType === "reps") return set.reps;
          return set.weight_kg * set.reps;
        };
        if (!groups[d] || getV(s) > getV(groups[d])) groups[d] = s;
      });
      filtered = Object.values(groups).sort(
        (a, b) =>
          new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
      );
    }

    const raw = filtered.map((s) => {
      let yVal = 0;
      if (yAxisType === "1rm")
        yVal =
          s.reps === 1 ? s.weight_kg : s.weight_kg / (1.0278 - 0.0278 * s.reps);
      else if (yAxisType === "weight") yVal = s.weight_kg;
      else if (yAxisType === "reps") yVal = s.reps;
      else yVal = s.weight_kg * s.reps;

      const prs = prMap[s.id] || { is1RM: false, isWT: false };
      return {
        value: Math.round(yVal * 10) / 10,
        xLabel:
          xAxisType === "date"
            ? format(parseISO(s.start_time), "MMM d")
            : xAxisType === "reps"
              ? `${s.reps}r`
              : `${s.weight_kg}k`,
        is1RMPR: prs.is1RM,
        isWeightPR: prs.isWT,
        weight: s.weight_kg,
        reps: s.reps,
        date: s.start_time,
        workout_id: s.workout_id,
        fullDate: format(parseISO(s.start_time), "MMMM d, yyyy"),
      };
    });

    if (xAxisType !== "date") {
      raw.sort((a: any, b: any) =>
        xAxisType === "reps" ? a.reps - b.reps : a.weight_kg - b.weight_kg,
      );
    }

    const interval = Math.max(1, Math.ceil(raw.length / 8));
    return raw.map((item, i) => {
      const isMilestone = item.is1RMPR || item.isWeightPR;
      return {
        ...item,
        label: i % interval === 0 ? item.xLabel : "",
        labelTextStyle: { color: colors.secondaryText, fontSize: 10 },
        dataPointColor: item.is1RMPR
          ? "#FFD700"
          : item.isWeightPR
            ? "#FF9500"
            : colors.tint,
        dataPointRadius: isMilestone ? 6 : 3,
      };
    });
  }, [
    sets,
    timeSpan,
    xAxisType,
    yAxisType,
    showTopSetsOnly,
    colors.secondaryText,
    colors.tint,
  ]);

  const chartMax = useMemo(() => {
    const mv = Math.max(...dynamicChartData.map((d) => d.value), 10);
    return mv * 1.5; // Large buffer for PR tags
  }, [dynamicChartData]);

  const chartProps = useMemo(() => {
    const sw = Dimensions.get("window").width;
    // ScrollView(16*2) + chartWrapper(16*2) = 64
    const horizontalPadding = 64;
    const yAxisWidth = 50;
    const rightPadding = 15;
    const avail = sw - horizontalPadding - yAxisWidth - rightPadding;

    // initialSpacing: 0 is mandatory for perfect touch-to-data mapping
    const spacing =
      dynamicChartData.length > 1 ? avail / (dynamicChartData.length - 1) : 0;

    return {
      data: dynamicChartData,
      width: avail,
      height: 220,
      maxValue: chartMax,
      noOfSections: 5,
      spacing: spacing,
      initialSpacing: 0,
      endSpacing: 0,
      color: colors.tint,
      thickness: 3,
      startFillColor: colors.tint,
      endFillColor: colors.tint,
      startOpacity: 0.2,
      endOpacity: 0.02,
      yAxisThickness: 0,
      xAxisThickness: 1,
      xAxisColor: colors.border,
      yAxisLabelWidth: 50,
      yAxisTextStyle: {
        color: colors.secondaryText,
        fontSize: 10,
        fontWeight: "bold",
      },
      xAxisLabelTextStyle: {
        color: colors.secondaryText,
        fontSize: 9,
        width: 80,
        textAlign: "center",
      },
      rotateLabel: true,
      labelRotation: -45,
      labelsExtraHeight: 50,
      hideDataPoints: false,
      renderDataPoint: (item: any) => {
        if (item.is1RMPR || item.isWeightPR) {
          const c = item.is1RMPR ? "#FFD700" : "#FF9500";
          const l = item.is1RMPR ? "1RM" : "WT";
          return (
            <View style={styles.markerContainer}>
              <View
                style={[
                  styles.markerDot,
                  { backgroundColor: c, borderColor: "#FFF" },
                ]}
              />
              <View style={[styles.markerTag, { backgroundColor: c }]}>
                <Text style={styles.markerText}>{l}</Text>
              </View>
            </View>
          );
        }
        return (
          <View
            style={[
              styles.normalDot,
              { backgroundColor: colors.tint, borderColor: colors.card },
            ]}
          />
        );
      },
      pointerConfig: {
        pointerStripUptoFullHeight: true,
        pointerStripColor: colors.border,
        pointerStripWidth: 2,
        strokeDashArray: [2, 5],
        pointerColor: colors.tint,
        radius: 6,
        pointerLabelWidth: 120,
        pointerLabelHeight: 90,
        activatePointerOnTap: true,
        pointerVanishDelay: 0,
        onPointerItemChange: (item: any) => {
          const active = Array.isArray(item) ? item[0] : item;
          if (active && active.value !== undefined)
            setActivePointerItem(active);
        },
        pointerLabelComponent: (items: any) => {
          if (!items || items.length === 0) return null;
          const active = items[0];
          return (
            <View
              style={[
                styles.pointerLabel,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text
                style={[styles.pointerDate, { color: colors.secondaryText }]}
              >
                {active.fullDate}
              </Text>
              <Text style={[styles.pointerVal, { color: colors.text }]}>
                {active.weight}kg x {active.reps}
              </Text>
              <Text
                style={{
                  fontSize: 10,
                  color: colors.secondaryText,
                  marginTop: 2,
                }}
              >
                {yAxisType.toUpperCase()}: {active.value}
                {yAxisType === "reps" ? "r" : "kg"}
              </Text>
            </View>
          );
        },
      },
    };
  }, [dynamicChartData, chartMax, colors, yAxisType]);

  const handleBack = () =>
    router.canGoBack() ? router.back() : router.replace("/app/dashboard");

  async function toggleFeatured() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !exercise) return;
    const { data: profile } = await supabase
      .from("profiles")
      .select("featured_exercise_ids")
      .eq("id", user.id)
      .single();
    let current = profile?.featured_exercise_ids || [];
    let updated = current.includes(id as string)
      ? current.filter((i: string) => i !== id)
      : [...current, id];
    const { error } = await supabase
      .from("profiles")
      .update({ featured_exercise_ids: updated })
      .eq("id", user.id);
    if (!error) {
      setIsFeatured(!isFeatured);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }

  const renderChart = () => {
    if (dynamicChartData.length === 0)
      return (
        <View
          style={[
            styles.emptyChart,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Ionicons
            name="stats-chart-outline"
            size={40}
            color={colors.border}
          />
          <Text
            style={[styles.emptyChartText, { color: colors.secondaryText }]}
          >
            More data needed
          </Text>
        </View>
      );

    return (
      <View
        style={[
          styles.chartWrapper,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View style={styles.chartHeaderLegacy}>
          <View>
            <Text style={[styles.chartTitleLegacy, { color: colors.text }]}>
              {yAxisType.toUpperCase()} vs {xAxisType.toUpperCase()}
            </Text>
            <Text style={[styles.chartSub, { color: colors.secondaryText }]}>
              {chartType === "line" ? "Line" : "Bar"} •{" "}
              {xAxisType === "date" ? timeSpan.toUpperCase() : "All"}
            </Text>
          </View>
          <Pressable
            onPress={() => setShowSettings(!showSettings)}
            style={[
              styles.settingsBtn,
              showSettings && { backgroundColor: colors.tint + "20" },
            ]}
          >
            <Ionicons
              name="options-outline"
              size={20}
              color={showSettings ? colors.tint : colors.secondaryText}
            />
          </Pressable>
        </View>

        <View
          style={[
            styles.activeHeader,
            { borderBottomColor: colors.border + "40" },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.activeDate, { color: colors.secondaryText }]}>
              {activePointerItem
                ? activePointerItem.fullDate
                : "Tap chart for details"}
            </Text>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                marginTop: 2,
              }}
            >
              <Text style={[styles.activeValueBig, { color: colors.text }]}>
                {activePointerItem
                  ? `${activePointerItem.value}${yAxisType === "reps" ? "r" : "kg"}`
                  : "-"}
              </Text>
              {(activePointerItem?.is1RMPR ||
                activePointerItem?.isWeightPR) && (
                <View style={styles.prBadge}>
                  <Ionicons name="trophy" size={10} color="#FFD700" />
                  <Text style={styles.prBadgeText}>NEW PR</Text>
                </View>
              )}
            </View>
          </View>
          {activePointerItem && (
            <Pressable
              onPress={() =>
                router.push(
                  `/app/workout/${activePointerItem.workout_id}` as any,
                )
              }
              style={[
                styles.miniViewWorkout,
                { backgroundColor: colors.tint + "10" },
              ]}
            >
              <Text style={[styles.miniViewText, { color: colors.tint }]}>
                VIEW
              </Text>
              <Ionicons name="chevron-forward" size={12} color={colors.tint} />
            </Pressable>
          )}
        </View>

        <View style={styles.prLegend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: "#FFD700" }]} />
            <Text style={[styles.legendText, { color: colors.secondaryText }]}>
              1RM PR
            </Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: "#FF9500" }]} />
            <Text style={[styles.legendText, { color: colors.secondaryText }]}>
              WT PR
            </Text>
          </View>
          <View style={styles.legendItem}>
            <View
              style={[styles.legendDot, { backgroundColor: colors.tint }]}
            />
            <Text style={[styles.legendText, { color: colors.secondaryText }]}>
              Normal
            </Text>
          </View>
        </View>

        {showSettings && (
          <View
            style={[styles.settingsPanel, { borderBottomColor: colors.border }]}
          >
            <View style={styles.settingRow}>
              <Text
                style={[styles.settingLabel, { color: colors.secondaryText }]}
              >
                Type
              </Text>
              <View style={styles.settingOptions}>
                {(["line", "bar"] as const).map((t) => (
                  <Pressable
                    key={t}
                    onPress={() => setChartType(t)}
                    style={[
                      styles.optionBtn,
                      chartType === t && { backgroundColor: colors.tint },
                    ]}
                  >
                    <Text
                      style={[
                        styles.optionText,
                        chartType === t && { color: "#FFF" },
                      ]}
                    >
                      {t.toUpperCase()}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <View style={styles.settingRow}>
              <Text
                style={[styles.settingLabel, { color: colors.secondaryText }]}
              >
                Y-Axis
              </Text>
              <View style={styles.settingOptions}>
                {(["1rm", "weight", "reps", "volume"] as const).map((y) => (
                  <Pressable
                    key={y}
                    onPress={() => setYAxisType(y)}
                    style={[
                      styles.optionBtn,
                      yAxisType === y && { backgroundColor: colors.tint },
                    ]}
                  >
                    <Text
                      style={[
                        styles.optionText,
                        yAxisType === y && { color: "#FFF" },
                      ]}
                    >
                      {y === "1rm" ? "1RM" : y.toUpperCase()}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <View style={styles.settingRow}>
              <Text
                style={[styles.settingLabel, { color: colors.secondaryText }]}
              >
                X-Axis
              </Text>
              <View style={styles.settingOptions}>
                {(["date", "reps", "weight"] as const).map((x) => (
                  <Pressable
                    key={x}
                    onPress={() => setXAxisType(x)}
                    style={[
                      styles.optionBtn,
                      xAxisType === x && { backgroundColor: colors.tint },
                    ]}
                  >
                    <Text
                      style={[
                        styles.optionText,
                        xAxisType === x && { color: "#FFF" },
                      ]}
                    >
                      {x.toUpperCase()}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <View style={styles.settingRow}>
              <Text
                style={[styles.settingLabel, { color: colors.secondaryText }]}
              >
                Filters
              </Text>
              <View style={styles.settingOptions}>
                <Pressable
                  onPress={() => setShowTopSetsOnly(!showTopSetsOnly)}
                  style={[
                    styles.optionBtn,
                    showTopSetsOnly && { backgroundColor: colors.tint },
                    { flex: 2 },
                  ]}
                >
                  <Text
                    style={[
                      styles.optionText,
                      showTopSetsOnly && { color: "#FFF" },
                    ]}
                  >
                    TOP SETS ONLY
                  </Text>
                </Pressable>
                {xAxisType === "date" &&
                  (["1m", "6m", "1y", "all"] as const).map((t) => (
                    <Pressable
                      key={t}
                      onPress={() => setTimeSpan(t)}
                      style={[
                        styles.optionBtn,
                        timeSpan === t && { backgroundColor: colors.tint },
                      ]}
                    >
                      <Text
                        style={[
                          styles.optionText,
                          timeSpan === t && { color: "#FFF" },
                        ]}
                      >
                        {t.toUpperCase()}
                      </Text>
                    </Pressable>
                  ))}
              </View>
            </View>
          </View>
        )}

        <View style={{ marginTop: 20, zIndex: 10, overflow: "visible" }}>
          {chartType === "line" ? (
            <LineChart {...chartProps} areaChart />
          ) : (
            <BarChart
              {...chartProps}
              barWidth={22}
              barBorderRadius={4}
              frontColor={colors.tint}
            />
          )}
        </View>
      </View>
    );
  };

  if (loading)
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    );
  if (!exercise)
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Exercise not found</Text>
      </View>
    );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 10, borderBottomColor: colors.border },
        ]}
      >
        <Pressable onPress={handleBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </Pressable>
        <View style={styles.headerInfo}>
          <Text
            style={[styles.headerTitle, { color: colors.text }]}
            numberOfLines={1}
          >
            {exercise.name}
          </Text>
          <Text
            style={[styles.headerSubtitle, { color: colors.secondaryText }]}
          >
            {exercise.muscle_group || "Full Body"}
          </Text>
        </View>
        <Pressable onPress={toggleFeatured} style={styles.featureBtn}>
          <Ionicons
            name={isFeatured ? "star" : "star-outline"}
            size={24}
            color={isFeatured ? "#FFD700" : colors.secondaryText}
          />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 20 },
        ]}
      >
        <View style={styles.statsGrid}>
          <View
            style={[
              styles.statBox,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.statLabel, { color: colors.secondaryText }]}>
              Est. 1RM
            </Text>
            <Text style={[styles.statValue, { color: colors.text }]}>
              {stats.oneRM} kg
            </Text>
          </View>
          <View
            style={[
              styles.statBox,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.statLabel, { color: colors.secondaryText }]}>
              Max Weight
            </Text>
            <Text style={[styles.statValue, { color: colors.text }]}>
              {stats.maxWeight} kg
            </Text>
          </View>
        </View>
        <View style={styles.statsGrid}>
          <View
            style={[
              styles.statBox,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.statLabel, { color: colors.secondaryText }]}>
              Best Set
            </Text>
            <Text style={[styles.statValue, { color: colors.text }]}>
              {stats.bestSet.weight}kg x {stats.bestSet.reps}
            </Text>
          </View>
          <View
            style={[
              styles.statBox,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.statLabel, { color: colors.secondaryText }]}>
              Total Sets
            </Text>
            <Text style={[styles.statValue, { color: colors.text }]}>
              {stats.totalSets}
            </Text>
          </View>
        </View>

        {renderChart()}

        {prMilestones.length > 0 && (
          <View style={styles.milestoneSection}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              1RM Milestones
            </Text>
            <View
              style={[
                styles.milestoneList,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              {prMilestones.slice(0, 10).map((ms, i) => (
                <Pressable
                  key={i}
                  style={[
                    styles.milestoneRow,
                    i < prMilestones.length - 1 && {
                      borderBottomColor: colors.border + "40",
                    },
                  ]}
                  onPress={() =>
                    router.push(`/app/workout/${ms.workout_id}` as any)
                  }
                >
                  <View style={styles.milestoneLeft}>
                    <Text
                      style={[styles.milestoneValue, { color: colors.text }]}
                    >
                      {ms.oneRM} kg
                    </Text>
                    <Text
                      style={[
                        styles.milestoneSub,
                        { color: colors.secondaryText },
                      ]}
                    >
                      {ms.weight}kg x {ms.reps}
                    </Text>
                  </View>
                  <View style={styles.milestoneRight}>
                    <Text
                      style={[
                        styles.milestoneDate,
                        { color: colors.secondaryText },
                      ]}
                    >
                      {format(parseISO(ms.date), "MMM d, yyyy")}
                    </Text>
                    <Ionicons
                      name="chevron-forward"
                      size={14}
                      color={colors.border}
                    />
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          History
        </Text>
        {sets
          .slice()
          .reverse()
          .map((set, index) => {
            const currD = format(parseISO(set.start_time), "yyyy-MM-dd");
            const prevS = sets[sets.length - index];
            const prevD = prevS
              ? format(parseISO(prevS.start_time), "yyyy-MM-dd")
              : null;
            const showD = index === 0 || currD !== prevD;
            const calc1RM =
              Math.round(
                (set.reps > 0
                  ? set.weight_kg / (1.0278 - 0.0278 * set.reps)
                  : 0) * 10,
              ) / 10;
            return (
              <View key={set.id}>
                {showD && (
                  <Text
                    style={[styles.dateHeader, { color: colors.secondaryText }]}
                  >
                    {format(parseISO(set.start_time), "MMMM d, yyyy")}
                  </Text>
                )}
                <Pressable
                  style={[styles.setRow, { borderBottomColor: colors.border }]}
                  onPress={() =>
                    router.push(`/app/workout/${set.workout_id}` as any)
                  }
                >
                  <View>
                    <Text style={[styles.setInfo, { color: colors.text }]}>
                      {set.weight_kg} kg x {set.reps}
                    </Text>
                    <Text
                      style={[
                        styles.oneRMDetail,
                        { color: colors.secondaryText },
                      ]}
                    >
                      Calc. 1RM: {calc1RM} kg
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={colors.border}
                  />
                </Pressable>
              </View>
            );
          })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  featureBtn: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  headerInfo: { flex: 1, alignItems: "center" },
  headerTitle: { fontSize: 16, fontWeight: "800", fontFamily: "System" },
  headerSubtitle: { fontSize: 12, fontWeight: "600", fontFamily: "System" },
  content: { padding: 16 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  statsGrid: { flexDirection: "row", gap: 12, marginBottom: 12 },
  statBox: { flex: 1, padding: 16, borderRadius: 12, borderWidth: 1 },
  statLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 4,
    fontFamily: "System",
  },
  statValue: { fontSize: 18, fontWeight: "800", fontFamily: "System" },
  chartWrapper: {
    marginTop: 12,
    marginBottom: 24,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "visible",
  },
  chartHeaderLegacy: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  chartTitleLegacy: { fontSize: 14, fontWeight: "900", fontFamily: "System" },
  activeHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    marginTop: 8,
    borderBottomWidth: 1,
  },
  activeDate: { fontSize: 11, fontWeight: "700", fontFamily: "System" },
  activeValueBig: { fontSize: 28, fontWeight: "900", fontFamily: "System" },
  miniViewWorkout: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  miniViewText: { fontSize: 10, fontWeight: "900" },
  prLegend: { flexDirection: "row", gap: 12, marginTop: 4, paddingBottom: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 9, fontWeight: "700", fontFamily: "System" },
  settingsBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  settingsPanel: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(128,128,128,0.1)",
    gap: 12,
  },
  settingRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  settingLabel: {
    width: 60,
    fontSize: 10,
    fontWeight: "800",
    fontFamily: "System",
  },
  settingOptions: { flex: 1, flexDirection: "row", gap: 6, flexWrap: "wrap" },
  optionBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "rgba(128,128,128,0.1)",
  },
  optionText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#888",
    fontFamily: "System",
  },
  markerContainer: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -15,
    marginTop: -15,
    overflow: "visible",
    zIndex: 100,
  },
  markerDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  markerTag: {
    position: "absolute",
    top: -16,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 2,
  },
  markerText: { color: "#000", fontSize: 7, fontWeight: "900" },
  normalDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1,
    marginLeft: -3,
    marginTop: -3,
  },
  pointerLabel: {
    left: -60,
    top: 40,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
  },
  pointerDate: {
    fontSize: 9,
    fontWeight: "700",
    marginBottom: 2,
    fontFamily: "System",
  },
  pointerVal: { fontSize: 14, fontWeight: "900", fontFamily: "System" },
  chartSub: { fontSize: 11, fontWeight: "700", fontFamily: "System" },
  prBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#FFD70020",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 4,
    alignSelf: "flex-start",
  },
  prBadgeText: {
    fontSize: 9,
    fontWeight: "900",
    color: "#FFD700",
    fontFamily: "System",
  },
  milestoneSection: { marginBottom: 24 },
  milestoneList: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  milestoneRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    borderBottomWidth: 1,
  },
  milestoneLeft: { flex: 1 },
  milestoneValue: { fontSize: 16, fontWeight: "800", fontFamily: "System" },
  milestoneSub: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
    fontFamily: "System",
  },
  milestoneRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  milestoneDate: { fontSize: 11, fontWeight: "700", fontFamily: "System" },
  emptyChart: {
    height: 200,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
    marginVertical: 12,
    borderStyle: "dashed",
  },
  emptyChartText: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "System",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
    marginTop: 20,
    marginBottom: 16,
    fontFamily: "System",
  },
  dateHeader: {
    fontSize: 13,
    fontWeight: "700",
    marginTop: 20,
    marginBottom: 12,
    fontFamily: "System",
  },
  setRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  setInfo: { fontSize: 16, fontWeight: "700", fontFamily: "System" },
  oneRMDetail: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
    fontFamily: "System",
  },
});
