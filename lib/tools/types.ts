import { z } from "zod";
import { sha256 } from '@noble/hashes/sha2.js';

export type SolanaTool = {
    title: string;
    description?: string;
    parameters: z.ZodRawShape;
    outputSchema?: z.ZodRawShape;
    func: (params: any) => Promise<any>;
};

export type InkeepResource = {
    type: string;
    record_type: string;
    url: string;
    title: string;
    source: {
        content: {
            type: string;
            text: string;
        }[];
        type: string;
    };
};

export type OpenAISearchResource = {
    id: string;
    title: string;
    text: string;
    url: string | null;
};

export function mapInkeepToOpenAI(inkeepResource: InkeepResource): OpenAISearchResource[] {
    const openaiResources: OpenAISearchResource[] = [];
    for (const content of inkeepResource.source.content) {
        openaiResources.push({
            id: Buffer.from(sha256(inkeepResource.title + content.text)).toString('base64'),
            title: inkeepResource.title,
            text: content.text,
            url: inkeepResource.url,
        });
    }
    return openaiResources;
}