import { z } from "zod";

export const parseLabels = (labels: string[]): Record<string, string> =>
  Object.fromEntries(
    z
      .string()
      .transform((s) => s.split("="))
      .pipe(z.tuple([z.string(), z.string()]))
      .array()
      .parse(labels)
  );
