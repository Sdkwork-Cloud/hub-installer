type DefinedProps<T extends Record<string, unknown>> = {
  [K in keyof T]?: Exclude<T[K], undefined>;
};

export function pickDefined<T extends Record<string, unknown>>(
  input: T
): DefinedProps<T> {
  const output: DefinedProps<T> = {};
  for (const key of Object.keys(input) as Array<keyof T>) {
    const value = input[key];
    if (value !== undefined) {
      output[key] = value as Exclude<T[typeof key], undefined>;
    }
  }
  return output;
}
