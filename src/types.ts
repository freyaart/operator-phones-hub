/** SI mobile operators supported by the sync layer. */
export const OPERATORS = ['a1', 'telekom', 't2', 'telemach'] as const;
export type OperatorId = (typeof OPERATORS)[number];

export function isOperatorId(v: string): v is OperatorId {
  return (OPERATORS as readonly string[]).includes(v);
}
