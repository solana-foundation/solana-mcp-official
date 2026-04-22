import { z } from "zod";

export type SolanaTool = {
  title: string;
  description?: string;
  parameters: z.ZodRawShape | z.ZodTypeAny;
  outputSchema?: z.ZodRawShape;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  func: (params: any) => Promise<any>;
};
