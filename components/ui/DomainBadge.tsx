import { StyleSheet, Text, View } from 'react-native';

import { domainsForColors, radii, spacing, typography, type Domain, useLifeOSColors } from '@/lib/design';

type Props = {
  domain: Domain;
  label?: string;
};

export function DomainBadge({ domain, label = domain }: Props) {
  const colors = useLifeOSColors();
  const token = domainsForColors(colors)[domain];

  return (
    <View style={[styles.badge, { backgroundColor: token.background, borderColor: token.color }]}>
      <Text style={[styles.text, { color: token.light }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 24,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm - 4,
  },
  text: {
    ...typography.labelCaps,
    textTransform: 'uppercase',
  },
});
