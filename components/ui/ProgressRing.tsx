import type { ReactNode } from 'react';
import { Text, View, StyleSheet, type TextStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { typography, useLifeOSColors } from '@/lib/design';

type Props = {
  progress: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
  arcDegrees?: number;
  valueStyle?: TextStyle;
  labelStyle?: TextStyle;
  children?: ReactNode;
};

export function ProgressRing({
  progress,
  size = 112,
  strokeWidth = 6,
  color,
  label,
  arcDegrees = 360,
  valueStyle,
  labelStyle,
  children,
}: Props) {
  const colors = useLifeOSColors();
  const accent = color ?? colors.violet;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const arcLength = circumference * (Math.max(0, Math.min(360, arcDegrees)) / 360);
  const clamped = Math.max(0, Math.min(100, progress));
  const offset = arcLength - (clamped / 100) * arcLength;
  const rotation = arcDegrees === 360 ? -90 : -90 - (360 - arcDegrees) / 2;

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.surface3}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${arcLength} ${circumference}`}
          transform={`rotate(${rotation} ${size / 2} ${size / 2})`}
          strokeLinecap="round"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={accent}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(${rotation} ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.center}>
        {children ?? (
          <>
            <Text style={[styles.value, { color: colors.textPrimary }, valueStyle]}>{Math.round(clamped)}</Text>
            {label ? <Text style={[styles.label, { color: colors.textMuted }, labelStyle]}>{label}</Text> : null}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  value: {
    ...typography.h1,
  },
  label: {
    ...typography.labelCaps,
  },
});
