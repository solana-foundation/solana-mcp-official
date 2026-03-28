import { z } from "zod";

export type SolanaTool = {
  title: string;
  description?: string;
  parameters: z.ZodRawShape;
  outputSchema?: z.ZodRawShape;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  func: (params: any) => Promise<any>;
};
