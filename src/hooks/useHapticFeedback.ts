import { useCallback } from 'react';

/**
 * Subtle vibration feedback for touch interactions (chart scrubbing, etc.).
 * No-ops on browsers/devices without the Vibration API (e.g. iOS Safari).
 */
export function useHapticFeedback() {
  const triggerHaptic = useCallback((pattern: number | number[] = 10) => {
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  }, []);

  return { triggerHaptic };
}
