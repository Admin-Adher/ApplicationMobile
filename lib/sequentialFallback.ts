/**
 * Runs fallbacks one at a time and stops after the first successful result.
 * This is deliberately sequential: parallel fallbacks can charge several
 * providers for a request that only needed one of them.
 */
export async function firstSuccessfulSequentially<TInput, TResult>(
  inputs: readonly TInput[],
  attempt: (input: TInput) => Promise<TResult | null>,
): Promise<TResult | null> {
  for (const input of inputs) {
    const result = await attempt(input);
    if (result !== null) return result;
  }
  return null;
}
