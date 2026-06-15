import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

function canUseHaptics() {
  return Platform.OS !== 'web';
}

export function hapticLight() {
  if (!canUseHaptics()) return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function hapticHeavy() {
  if (!canUseHaptics()) return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
}

export function hapticSuccess() {
  if (!canUseHaptics()) return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}
