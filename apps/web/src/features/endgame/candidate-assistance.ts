export function candidateAssistanceMultiplier(accelerationPercent: number): string {
  const multiplier = 1 + accelerationPercent / 100;
  return `×${multiplier.toFixed(2).replace(/\.?0+$/, "")}`;
}
