import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  Dimensions,
  Platform,
} from "react-native";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Line,
  Polygon,
  Polyline,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../../lib/supabase";
import { useThemeColor } from "../../../lib/theme";
import { usePreferences } from "../../../lib/preferences";
import { useFocusEffect } from "expo-router";
import { format, parseISO } from "date-fns";
import * as Haptics from "expo-haptics";
import { BarChart } from "react-native-gifted-charts";

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

interface ProgressChartPoint {
  value: number;
  xLabel: string;
  is1RMPR: boolean;
  isWeightPR: boolean;
  weight: number;
  reps: number;
  date: string;
  workout_id: string;
  fullDate: string;
}

interface ProgressChartProps {
  data: ProgressChartPoint[];
  maxValue: number;
  yAxisOffset: number;
  stepValue: number;
  colors: ReturnType<typeof useThemeColor>;
  yAxisType: "weight" | "reps" | "1rm" | "volume";
  activePoint: ProgressChartPoint | null;
  onSelect: (point: ProgressChartPoint | null) => void;
}

interface ChartNativePointerEvent {
  nativeEvent: {
    locationX?: number;
  };
}

interface ChartInteractionProps {
  onMouseMove?: (event: ChartNativePointerEvent) => void;
  onPointerMove?: (event: ChartNativePointerEvent) => void;
}

interface RepRecord {
  reps: number;
  weight: number;
  date: string;
  workout_id: string;
  estimated1RM: number;
}

const InteractiveView = View as React.ComponentType<
  React.ComponentProps<typeof View> &
    ChartInteractionProps &
    React.RefAttributes<unknown>
>;
const InteractiveSvg = Svg as React.ComponentType<
  React.ComponentProps<typeof Svg> & ChartInteractionProps
>;

function ProgressChart({
  data,
  maxValue,
  yAxisOffset,
  stepValue,
  colors,
  yAxisType,
  activePoint,
  onSelect,
}: ProgressChartProps) {
  const [layout, setLayout] = React.useState({ width: 0, height: 220 });
  const chartSurfaceRef = React.useRef<HTMLElement | null>(null);
  const activePointRef = React.useRef(activePoint);
  activePointRef.current = activePoint;

  const width = layout.width || 360;
  const height = layout.height;

  const padding = { left: 48, right: 16, top: 16, bottom: 32 };
  const plotWidth = Math.max(1, width - padding.left - padding.right);
  const plotHeight = Math.max(1, height - padding.top - padding.bottom);

  const valueToY = (value: number) =>
    padding.top + (1 - (value - yAxisOffset) / maxValue) * plotHeight;

  const pointToX = (index: number) =>
    data.length === 1
      ? padding.left + plotWidth / 2
      : padding.left + (index / (data.length - 1)) * plotWidth;

  const points = data.map((point, index) => ({
    point,
    x: pointToX(index),
    y: valueToY(point.value),
  }));

  const linePoints = points.map(({ x, y }) => `${x},${y}`).join(" ");
  const areaPoints = [
    `${padding.left},${height - padding.bottom}`,
    linePoints,
    `${points[points.length - 1]?.x ?? padding.left},${height - padding.bottom}`,
  ].join(" ");

  const tickCount = Math.max(1, Math.round(maxValue / stepValue));
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) => {
    const value = yAxisOffset + stepValue * index;
    return { value, y: valueToY(value) };
  });

  const labelCount = Math.min(6, data.length);
  const labelIndexes = new Set(
    Array.from({ length: labelCount }, (_, index) =>
      labelCount === 1
        ? 0
        : Math.round((index * (data.length - 1)) / (labelCount - 1)),
    ),
  );

  const selectedIndex = activePoint
    ? data.findIndex(
        (point) =>
          point.date === activePoint.date && point.value === activePoint.value,
      )
    : -1;
  const selected = selectedIndex >= 0 ? points[selectedIndex] : null;
  const gradientId = `progress-fill-${yAxisType}`;

  const selectClosest = React.useCallback(
    (locationX: number) => {
      if (!data.length) return;
      const clampedX = Math.max(
        padding.left,
        Math.min(width - padding.right, locationX),
      );
      const index = Math.round(
        ((clampedX - padding.left) / plotWidth) * (data.length - 1),
      );
      const nextPoint = data[Math.max(0, Math.min(data.length - 1, index))];
      if (
        activePointRef.current?.date !== nextPoint.date ||
        activePointRef.current?.value !== nextPoint.value
      ) {
        onSelect(nextPoint);
      }
    },
    [data, onSelect, padding.left, padding.right, plotWidth, width],
  );

  const handlePointerMove = (event: ChartNativePointerEvent) => {
    const locationX = event.nativeEvent.locationX;
    if (typeof locationX === "number") selectClosest(locationX);
  };

  React.useEffect(() => {
    if (Platform.OS !== "web" || !chartSurfaceRef.current) return;
    const surface = chartSurfaceRef.current;
    const handleWebPointerMove = (event: PointerEvent) => {
      const bounds = surface.getBoundingClientRect();
      selectClosest(event.clientX - bounds.left);
    };
    surface.addEventListener("pointermove", handleWebPointerMove);
    return () => {
      surface.removeEventListener("pointermove", handleWebPointerMove);
    };
  }, [onSelect, selectClosest]);

  return (
    <InteractiveView
      ref={(node: unknown) => {
        chartSurfaceRef.current = node as unknown as HTMLElement | null;
      }}
      style={styles.progressChart}
      onLayout={(event) => {
        const { width: w, height: h } = event.nativeEvent.layout;
        if (w > 0 && h > 0) {
          setLayout({ width: w, height: h });
        }
      }}
      onMouseMove={Platform.OS === "web" ? handlePointerMove : undefined}
      onPointerMove={Platform.OS === "web" ? handlePointerMove : undefined}
      onStartShouldSetResponder={Platform.OS === "web" ? undefined : () => true}
      onResponderGrant={Platform.OS === "web" ? undefined : handlePointerMove}
      onResponderMove={Platform.OS === "web" ? undefined : handlePointerMove}
    >
      {layout.width > 0 && (
        <InteractiveSvg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
        >
          <Defs>
            <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.tint} stopOpacity={0.2} />
              <Stop offset="1" stopColor={colors.tint} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {ticks.map((tick) => (
            <React.Fragment key={tick.value}>
              <Line
                x1={padding.left}
                y1={tick.y}
                x2={width - padding.right}
                y2={tick.y}
                stroke={colors.border}
                strokeOpacity={0.4}
                strokeDasharray="3 5"
              />
              <SvgText
                x={padding.left - 8}
                y={tick.y + 4}
                fill={colors.secondaryText}
                fontSize={11}
                textAnchor="end"
                fontFamily={
                  Platform.OS === "web"
                    ? "system-ui, -apple-system, sans-serif"
                    : undefined
                }
              >
                {String(Math.round(tick.value * 10) / 10)}
              </SvgText>
            </React.Fragment>
          ))}
          {data.length > 1 && (
            <Polygon points={areaPoints} fill={`url(#${gradientId})`} />
          )}
          {data.length > 1 && (
            <Polyline
              points={linePoints}
              fill="none"
              stroke={colors.tint}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {points.map(({ point, x, y }) => {
            const isPr = point.is1RMPR || point.isWeightPR;
            return isPr ? (
              <Circle
                key={`${point.date}-${point.value}`}
                cx={x}
                cy={y}
                r={4.5}
                fill={point.is1RMPR ? "#FFD700" : "#FF9500"}
                stroke={colors.card}
                strokeWidth={2}
              />
            ) : null;
          })}
          {selected && (
            <>
              <Line
                x1={selected.x}
                y1={padding.top}
                x2={selected.x}
                y2={height - padding.bottom}
                stroke={colors.secondaryText}
                strokeOpacity={0.7}
                strokeDasharray="3 4"
              />
              <Line
                x1={padding.left}
                y1={selected.y}
                x2={width - padding.right}
                y2={selected.y}
                stroke={colors.secondaryText}
                strokeOpacity={0.5}
                strokeDasharray="3 4"
              />
              <Circle
                cx={selected.x}
                cy={selected.y}
                r={4}
                fill={colors.tint}
                stroke={colors.card}
                strokeWidth={2}
              />
            </>
          )}
          {data.map((point, index) =>
            labelIndexes.has(index) ? (
              <SvgText
                key={`label-${point.date}`}
                x={pointToX(index)}
                y={height - 8}
                fill={colors.secondaryText}
                fontSize={11}
                fontFamily={
                  Platform.OS === "web"
                    ? "system-ui, -apple-system, sans-serif"
                    : undefined
                }
                textAnchor={
                  index === 0
                    ? "start"
                    : index === data.length - 1
                      ? "end"
                      : "middle"
                }
              >
                {point.xLabel}
              </SvgText>
            ) : null,
          )}
        </InteractiveSvg>
      )}
    </InteractiveView>
  );
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
      let isMounted = true;

      const fetchData = async () => {
        try {
          setLoading(true);
          const {
            data: { session },
            error: sessionError,
          } = await supabase.auth.getSession();

          if (sessionError || !session?.user || !isMounted) {
            if (isMounted) setLoading(false);
            return;
          }

          const user = session.user;

          const [exRes, profileRes] = await Promise.all([
            supabase.from("exercises").select("*").eq("id", id).single(),
            supabase
              .from("profiles")
              .select("featured_exercise_ids")
              .eq("id", user.id)
              .single(),
          ]);

          if (!isMounted) return;

          if (exRes.data) {
            setExercise(exRes.data);
            if (profileRes.data) {
              const featured = (
                profileRes.data.featured_exercise_ids || []
              ).includes(id as string);
              setIsFeatured(featured);
            }
          }

          let allSetsData: any[] = [];
          let rangeStart = 0;
          const rangeStep = 1000;
          let hasMore = true;

          while (hasMore && isMounted) {
            const { data: setsData, error } = await supabase
              .from("sets")
              .select(
                "id, weight_kg, reps, workout_id, workouts!inner(start_time)",
              )
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

          if (!isMounted) return;

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
                new Date(a.start_time).getTime() -
                new Date(b.start_time).getTime(),
            );
            setSets(formattedSets);

            let max1RM = 0;
            let bestWeight = 0;
            let bestReps = 0;

            formattedSets.forEach((s) => {
              const weight = s.weight_kg;
              const reps = s.reps;
              const oneRM =
                reps === 1 ? weight : weight / (1.0278 - 0.0278 * reps);

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
        } catch (err: any) {
          if (!err?.message?.includes("aborted")) {
            console.error("Failed to load exercise data:", err);
          }
        } finally {
          if (isMounted) {
            setLoading(false);
          }
        }
      };

      fetchData();

      return () => {
        isMounted = false;
      };
    }, [id]),
  );

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

  const repRecords = useMemo(() => {
    if (sets.length === 0) return [];

    const recordMap = new Map<number, RepRecord>();

    sets.forEach((s) => {
      if (s.reps < 1 || s.reps > 12) return;

      const currentBest = recordMap.get(s.reps);
      if (!currentBest || s.weight_kg > currentBest.weight) {
        const calc1RM =
          s.reps === 1
            ? s.weight_kg
            : s.weight_kg / (1.0278 - 0.0278 * s.reps);

        recordMap.set(s.reps, {
          reps: s.reps,
          weight: s.weight_kg,
          date: s.start_time,
          workout_id: s.workout_id,
          estimated1RM: Math.round(calc1RM * 10) / 10,
        });
      }
    });

    return Array.from(recordMap.values()).sort((a, b) => a.reps - b.reps);
  }, [sets]);

  const dynamicChartData = useMemo(() => {
    if (sets.length === 0) return [];

    const prMap: Record<string, { is1RM: boolean; isWT: boolean }> = {};
    let runMax1RM = 0;
    let runMaxWT = 0;

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
          s.reps === 1
            ? s.weight_kg
            : s.weight_kg / (1.0278 - 0.0278 * s.reps);
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

  const chartAxis = useMemo(() => {
    const values = dynamicChartData.map((item) => item.value);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values, 10);
    const isRelativeMetric = yAxisType === "1rm" || yAxisType === "weight";

    if (!isRelativeMetric) {
      const step =
        yAxisType === "volume"
          ? Math.max(1, Math.ceil(maxValue / 4 / 10) * 10)
          : maxValue >= 20
            ? 5
            : 2;
      const top = Math.max(
        step * 4,
        Math.ceil((maxValue + step) / step) * step,
      );
      return {
        offset: 0,
        max: top,
        step,
        sections: Math.round(top / step),
      };
    }

    const step = maxValue >= 100 ? 10 : 5;
    const offset = Math.max(0, Math.floor((minValue - step) / step) * step);
    const top = Math.ceil((maxValue + step) / step) * step;
    const range = Math.max(step * 4, top - offset);

    return {
      offset,
      max: range,
      step,
      sections: Math.round(range / step),
    };
  }, [dynamicChartData, yAxisType]);

  useEffect(() => {
    setActivePointerItem(null);
  }, [timeSpan, xAxisType, yAxisType, showTopSetsOnly]);

  const visibleChartData = useMemo(() => {
    const maxPoints = 96;
    if (dynamicChartData.length <= maxPoints) return dynamicChartData;

    if (xAxisType === "date") {
      const bucketDays = Math.ceil(dynamicChartData.length / maxPoints);
      const buckets = new Map<string, (typeof dynamicChartData)[number]>();

      dynamicChartData.forEach((item) => {
        const date = new Date(item.date);
        const bucketStart = new Date(date);
        bucketStart.setDate(date.getDate() - (date.getDate() % bucketDays));
        const key = bucketStart.toISOString().slice(0, 10);
        const current = buckets.get(key);
        if (
          !current ||
          item.value > current.value ||
          item.is1RMPR ||
          item.isWeightPR
        ) {
          buckets.set(key, item);
        }
      });

      return Array.from(buckets.values()).sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      );
    }

    const interval = Math.ceil(dynamicChartData.length / maxPoints);
    return dynamicChartData.filter((_, index) => index % interval === 0);
  }, [dynamicChartData, xAxisType]);

  const chartProps = useMemo(() => {
    const sw = Dimensions.get("window").width;
    const chartWidth = Math.max(280, sw - 112);
    const yAxisWidth = 42;
    const avail = chartWidth - yAxisWidth;

    const spacing =
      visibleChartData.length > 1 ? avail / (visibleChartData.length - 1) : 0;

    return {
      data: visibleChartData,
      width: avail,
      height: 230,
      maxValue: chartAxis.max,
      yAxisOffset: chartAxis.offset,
      stepValue: chartAxis.step,
      noOfSections: chartAxis.sections,
      spacing: spacing,
      initialSpacing: 0,
      endSpacing: 4,
      color: colors.tint,
      thickness: 2.5,
      startFillColor: colors.tint,
      endFillColor: colors.tint,
      startOpacity: 0.12,
      endOpacity: 0,
      yAxisThickness: 0,
      xAxisThickness: 1,
      xAxisColor: colors.border,
      yAxisLabelWidth: yAxisWidth,
      yAxisTextStyle: {
        color: colors.secondaryText,
        fontSize: 10,
        fontWeight: "bold" as const,
      },
      xAxisLabelTextStyle: {
        color: colors.secondaryText,
        fontSize: 8,
        width: 58,
        textAlign: "center" as const,
      },
      rotateLabel: true,
      labelRotation: -35,
      labelsExtraHeight: 38,
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
  }, [visibleChartData, chartAxis, colors, yAxisType]);

  const handleBack = () =>
    router.canGoBack() ? router.back() : router.replace("/app/dashboard");

  async function toggleFeatured() {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
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
    } catch (err: any) {
      if (!err?.message?.includes("aborted")) {
        console.error("toggleFeatured error:", err);
      }
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
                : Platform.OS === "web"
                  ? t("app.exercise.chart_hover_hint")
                  : t("app.exercise.chart_drag_hint")}
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
              {activePointerItem && (
                <Text
                  style={[
                    styles.activeSetDetail,
                    { color: colors.secondaryText },
                  ]}
                >
                  {activePointerItem.weight}kg × {activePointerItem.reps}
                </Text>
              )}
              {(activePointerItem?.is1RMPR ||
                activePointerItem?.isWeightPR) && (
                <View style={styles.prBadge}>
                  <Ionicons name="trophy" size={10} color="#FFD700" />
                  <Text style={styles.prBadgeText}>
                    {t("app.exercise.new_pr")}
                  </Text>
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
            <ProgressChart
              data={visibleChartData}
              maxValue={chartAxis.max}
              yAxisOffset={chartAxis.offset}
              stepValue={chartAxis.step}
              colors={colors}
              yAxisType={yAxisType}
              activePoint={activePointerItem}
              onSelect={setActivePointerItem}
            />
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
        <Text style={{ color: colors.text }}>
          {t("app.exercise.not_found")}
        </Text>
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

        <View style={styles.recordSection}>
          <View style={styles.recordHeaderRow}>
            <Text
              style={[
                styles.sectionTitle,
                { color: colors.text, marginBottom: 0 },
              ]}
            >
              Personal Records by Reps
            </Text>
            <Text
              style={[styles.recordSubTitle, { color: colors.secondaryText }]}>
              All-time bests
            </Text>
          </View>

          <View
            style={[
              styles.recordCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            {repRecords.length === 0 ? (
              <View style={{ padding: 16, alignItems: "center" }}>
                <Text
                  style={{
                    color: colors.secondaryText,
                    fontSize: 13,
                    fontWeight: "600",
                  }}
                >
                  No records logged yet
                </Text>
              </View>
            ) : (
              repRecords.map((item, index) => (
                <Pressable
                  key={item.reps}
                  style={[
                    styles.recordRow,
                    index < repRecords.length - 1 && {
                      borderBottomColor: colors.border + "30",
                    },
                  ]}
                  onPress={() =>
                    router.push(`/app/workout/${item.workout_id}` as any)
                  }
                >
                  {/* Left: Rep Tag & Weight */}
                  <View style={styles.recordLeft}>
                    <View
                      style={[
                        styles.repBadge,
                        item.reps === 1
                          ? {
                              backgroundColor: "#FFD70025",
                              borderColor: "#FFD700",
                            }
                          : {
                              backgroundColor: colors.border + "40",
                              borderColor: "transparent",
                            },
                      ]}
                    >
                      <Text
                        style={[
                          styles.repBadgeText,
                          {
                            color: item.reps === 1 ? "#FFD700" : colors.text,
                          },
                        ]}
                      >
                        {item.reps}RM
                      </Text>
                    </View>
                    <View>
                      <Text
                        style={[styles.recordWeight, { color: colors.text }]}
                      >
                        {item.weight} kg
                      </Text>
                      {item.reps > 1 && (
                        <Text
                          style={[
                            styles.recordEst1RM,
                            { color: colors.secondaryText },
                          ]}
                        >
                          ~{item.estimated1RM} kg 1RM
                        </Text>
                      )}
                    </View>
                  </View>

                  {/* Right: Date achieved & Link arrow */}
                  <View style={styles.recordRight}>
                    <Text
                      style={[
                        styles.recordDate,
                        { color: colors.secondaryText },
                      ]}
                    >
                      {format(parseISO(item.date), "MMM d, yyyy")}
                    </Text>
                    <Ionicons
                      name="chevron-forward"
                      size={14}
                      color={colors.secondaryText}
                    />
                  </View>
                </Pressable>
              ))
            )}
          </View>
        </View>
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
  content: {
    padding: 16,
    width: "100%",
    maxWidth: 920,
    alignSelf: "center",
  },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 12,
  },
  statBox: {
    flex: 1,
    flexBasis: "40%",
    minWidth: 140,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
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
    width: "100%",
    maxWidth: 880,
    alignSelf: "center",
    borderRadius: 16,
    borderWidth: 1,
    overflow: "visible",
  },
  progressChart: {
    width: "100%",
    height: 220,
    maxWidth: "100%",
    alignSelf: "stretch",
    position: "relative",
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
  activeSetDetail: { fontSize: 11, fontWeight: "700", marginLeft: 2 },
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
    boxShadow: "0px 2px 2px rgba(0, 0, 0, 0.5)",
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
    boxShadow: "0px 4px 4px rgba(0, 0, 0, 0.3)",
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
  recordSection: {
    marginTop: 20,
    marginBottom: 24,
  },
  recordHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 12,
  },
  recordSubTitle: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: "System",
  },
  recordCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  recordRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  recordLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  repBadge: {
    width: 44,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  repBadgeText: {
    fontSize: 12,
    fontWeight: "800",
    fontFamily: "System",
  },
  recordWeight: {
    fontSize: 15,
    fontWeight: "800",
    fontFamily: "System",
  },
  recordEst1RM: {
    fontSize: 10,
    fontWeight: "600",
    fontFamily: "System",
    marginTop: 1,
  },
  recordRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  recordDate: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: "System",
  },
});