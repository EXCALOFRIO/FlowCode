// use server'
'use server';
/**
 * @fileOverview This file defines a Genkit flow that generates a detailed plan
 * for fulfilling a user's request, including file analysis, external information
 * search, and result visualization.
 *
 * - generateDetailedPlan - The main function to generate the detailed plan.
 * - GenerateDetailedPlanInput - The input type for the generateDetailedPlan function.
 * - GenerateDetailedPlanOutput - The output type for the generateDetailedPlan function.
 */

import {ai} from '@/ai/ai-instance';
import {z} from 'genkit';
import {getSearchResults} from '@/services/google-grounding';

const GenerateDetailedPlanInputSchema = z.object({
  prompt: z.string().describe('The user prompt describing the desired outcome.'),
  fileNames: z.array(z.string()).optional().describe('The names of the files uploaded by the user.'),
  fileContents: z.array(z.string()).optional().describe('The contents of the files uploaded by the user.'),
});
export type GenerateDetailedPlanInput = z.infer<typeof GenerateDetailedPlanInputSchema>;

const GenerateDetailedPlanOutputSchema = z.object({
  plan: z.string().describe('A detailed plan outlining the steps to fulfill the user request.'),
  requiresExternalInfo: z.boolean().describe('Whether the plan requires searching for external information.'),
  requiresFileAnalysis: z.boolean().describe('Whether the plan requires analyzing the uploaded files.'),
  visualizationDetails: z.string().describe('Details on how the results will be visualized.'),
});
export type GenerateDetailedPlanOutput = z.infer<typeof GenerateDetailedPlanOutputSchema>;

export async function generateDetailedPlan(input: GenerateDetailedPlanInput): Promise<GenerateDetailedPlanOutput> {
  return generateDetailedPlanFlow(input);
}

const generateDetailedPlanPrompt = ai.definePrompt({
  name: 'generateDetailedPlanPrompt',
  input: {
    schema: z.object({
      prompt: z.string().describe('The user prompt describing the desired outcome.'),
      fileNames: z.array(z.string()).optional().describe('The names of the files uploaded by the user.'),
      fileContents: z.array(z.string()).optional().describe('The contents of the files uploaded by the user.'),
    }),
  },
  output: {
    schema: z.object({
      plan: z.string().describe('A detailed plan outlining the steps to fulfill the user request.'),
      requiresExternalInfo: z.boolean().describe('Whether the plan requires searching for external information.'),
      requiresFileAnalysis: z.boolean().describe('Whether the plan requires analyzing the uploaded files.'),
      visualizationDetails: z.string().describe('Details on how the results will be visualized, including chart types and data representation.'),
    }),
  },
  prompt: `You are an AI planning assistant. Your task is to generate a detailed plan to fulfill the user's request based on their prompt and any uploaded files.

  User Prompt: {{{prompt}}}

  {{#if fileNames}}
  Uploaded Files: {{#each fileNames}}{{{this}}}{{#unless @last}}, {{/unless}}{{/each}}
  {{/if}}

  Consider these steps:
  1.  Understand the user's request and break it down into smaller, manageable tasks.
  2.  If file names are present determine which files are relevant to the user's request.
  3.  Determine if external information is needed to fulfill the request. If so, specify what information to search for.
  4.  Outline the steps to analyze the files, extract relevant information, and process the data.
  5.  Decide on the best way to visualize the results (e.g., chart type, data representation) and include those details in the plan.
  6.  Detail how you will generate files of different types (TXT, PNG, XLSX, GIF...).

  Your output should include:
  - A detailed plan outlining the steps to fulfill the user request.
  - A boolean value indicating whether the plan requires searching for external information (requiresExternalInfo).
  - A boolean value indicating whether the plan requires analyzing the uploaded files (requiresFileAnalysis).
  - Specific details on how the results will be visualized (visualizationDetails).

  Make sure to return a plan that is easy to follow and understand for the user. Be as specific as possible.
  `,
});

const generateDetailedPlanFlow = ai.defineFlow<
  typeof GenerateDetailedPlanInputSchema,
  typeof GenerateDetailedPlanOutputSchema
>(
  {
    name: 'generateDetailedPlanFlow',
    inputSchema: GenerateDetailedPlanInputSchema,
    outputSchema: GenerateDetailedPlanOutputSchema,
  },
  async input => {
    const {output} = await generateDetailedPlanPrompt(input);
    return output!;
  }
);
