// src/ai/flows/enhance-prompt.ts
'use server';

/**
 * @fileOverview Enhances the user's initial prompt for better clarity and context.
 *
 * - enhancePrompt - A function that enhances the prompt.
 * - EnhancePromptInput - The input type for the enhancePrompt function.
 * - EnhancePromptOutput - The return type for the enhancePrompt function.
 */

import {ai} from '@/ai/ai-instance';
import {z} from 'genkit';

const EnhancePromptInputSchema = z.object({
  prompt: z.string().describe('The initial prompt provided by the user.'),
  files: z
    .array(z.string())
    .optional()
    .describe(
      'An optional array of file names that the user has uploaded. Only the names are passed here, not the content.'
    ),
});
export type EnhancePromptInput = z.infer<typeof EnhancePromptInputSchema>;

const EnhancePromptOutputSchema = z.object({
  enhancedPrompt: z.string().describe('The enhanced prompt with improved clarity and context.'),
  needsExternalInfo: z
    .boolean()
    .describe('Whether the prompt requires external information from the internet.'),
  needsFileAnalysis: z
    .boolean()
    .describe('Whether the prompt requires analysis of the uploaded files.'),
});
export type EnhancePromptOutput = z.infer<typeof EnhancePromptOutputSchema>;

export async function enhancePrompt(input: EnhancePromptInput): Promise<EnhancePromptOutput> {
  return enhancePromptFlow(input);
}

const enhancePromptPrompt = ai.definePrompt({
  name: 'enhancePromptPrompt',
  input: {
    schema: z.object({
      prompt: z.string().describe('The initial prompt provided by the user.'),
      files: z
        .array(z.string())
        .optional()
        .describe('An optional array of file names that the user has uploaded.'),
    }),
  },
  output: {
    schema: z.object({
      enhancedPrompt: z.string().describe('The enhanced prompt with improved clarity and context.'),
      needsExternalInfo: z
        .boolean()
        .describe('Whether the prompt requires external information from the internet.'),
      needsFileAnalysis: z
        .boolean()
        .describe('Whether the prompt requires analysis of the uploaded files.'),
    }),
  },
  prompt: `You are an AI assistant designed to enhance user prompts for better clarity and context.

  The user has provided the following prompt:
  {{prompt}}

  The user has also uploaded the following files: {{#if files}}{{#each files}}{{{this}}}{{#unless @last}}, {{/unless}}{{/each}}{{else}}No files uploaded{{/if}}

  Please enhance the prompt to ensure it is clear, concise, and includes all necessary context for generating a detailed plan of action.  Determine if external information from the internet is needed to fulfill the request. Also, determine if uploaded files need to be analyzed to fulfill the request. Return a JSON object with the enhanced prompt, a boolean indicating if external information is needed, and a boolean indicating if file analysis is needed.

  Ensure that the returned value is a JSON object.
  `,
});

const enhancePromptFlow = ai.defineFlow<typeof EnhancePromptInputSchema, typeof EnhancePromptOutputSchema>(
  {
    name: 'enhancePromptFlow',
    inputSchema: EnhancePromptInputSchema,
    outputSchema: EnhancePromptOutputSchema,
  },
  async input => {
    const {output} = await enhancePromptPrompt(input);
    return output!;
  }
);
