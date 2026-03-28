import { z } from "zod";

export type SolanaTool = {
    title: string;
    description?: string;
    parameters: z.ZodRawShape;
    outputSchema?: z.ZodRawShape;
    func: (params: any) => Promise<any>;
};