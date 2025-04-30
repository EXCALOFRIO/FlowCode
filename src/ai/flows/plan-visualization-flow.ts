// src/ai/flows/plan-visualization-flow.ts
'use server';
/**
 * @fileOverview This file defines a Genkit flow for planning the visualization of results based on user input and files.
 *
 * - planVisualization - A function that takes user input and files, and returns a plan for visualizing the results.
 * - PlanVisualizationInput - The input type for the planVisualization function, including a prompt and optional file data URIs.
 * - PlanVisualizationOutput - The output type for the planVisualization function, describing the plan for visualization.
 */

import {ai} from '@/ai/ai-instance';
import {z} from 'genkit';
import {getSearchResults} from '@/services/google-grounding';

const PlanVisualizationInputSchema = z.object({
  prompt: z.string().describe('The user prompt describing the desired outcome.'),
  fileDataUris: z
    .array(z.string())
    .optional()
    .describe(
      'An optional list of files, as data URIs that must include a MIME type and use Base64 encoding. Expected format: data:<mimetype>;base64,<encoded_data>.'
    ),
});
export type PlanVisualizationInput = z.infer<typeof PlanVisualizationInputSchema>;

const PlanVisualizationOutputSchema = z.object({
  plan: z.string().describe('A detailed plan for visualizing the results, including steps and visualization formats.'),
  requiresExternalInfo: z.boolean().describe('Whether the plan requires external information.'),
  requiresFileAnalysis: z.boolean().describe('Whether the plan requires analysis of the uploaded files.'),
  visualizationFormats: z
    .array(z.string())
    .describe('The list of visualization formats to use, example: text, table, graph, animation'),
});
export type PlanVisualizationOutput = z.infer<typeof PlanVisualizationOutputSchema>;

export async function planVisualization(input: PlanVisualizationInput): Promise<PlanVisualizationOutput> {
  return planVisualizationFlow(input);
}

const analyzePromptAndFilesPrompt = ai.definePrompt({
  name: 'analyzePromptAndFilesPrompt',
  input: {
    schema: z.object({
      prompt: z.string().describe('The user prompt describing the desired outcome.'),
      fileDataUris: z
        .array(z.string())
        .optional()
        .describe(
          'An optional list of files, as data URIs that must include a MIME type and use Base64 encoding. Expected format: data:<mimetype>;base64,<encoded_data>.'
        ),
    }),
  },
  output: {
    schema: z.object({
      plan: z.string().describe('A detailed plan for visualizing the results, including steps and visualization formats.'),
      requiresExternalInfo: z.boolean().describe('Whether the plan requires external information.'),
      requiresFileAnalysis: z.boolean().describe('Whether the plan requires analysis of the uploaded files.'),
      visualizationFormats: z
        .array(z.string())
        .describe('The list of visualization formats to use, example: text, table, graph, animation'),
    }),
  },
  prompt: `You are an AI assistant that takes user input and files, and returns a detailed plan for visualizing the results.

  User Prompt: {{{prompt}}}
  {{#if fileDataUris}}
  Files:
  {{#each fileDataUris}}
  - {{media url=this}}
  {{/each}}
  {{/if}}

  Based on the prompt and available files, create a plan for visualizing the results. The plan should include:
  - Steps to be taken to achieve the desired outcome.
  - The best way to visualize each part of the result (text, table, graph, animation, etc.).

  Determine whether the plan requires external information or analysis of the uploaded files. Specify the visualization formats to use.

  Return the plan, external information requirement, file analysis requirement, and visualization formats in a structured format.
  `,
});

const planVisualizationFlow = ai.defineFlow<
  typeof PlanVisualizationInputSchema,
  typeof PlanVisualizationOutputSchema
>({
  name: 'planVisualizationFlow',
  inputSchema: PlanVisualizationInputSchema,
  outputSchema: PlanVisualizationOutputSchema,
},
async input => {
  let initialPlan;
  try {
    // Phase 1: Improve and initial planning
    const {output} = await analyzePromptAndFilesPrompt(input);
    initialPlan = output;

    if (!initialPlan) {
      throw new Error('AI failed to generate an initial plan.');
    }
  } catch (error: any) {
      console.error("Error calling AI model in planVisualizationFlow:", error);
      // Check for common API error indicators (like status codes or specific messages)
      if (error.message?.includes('503') || error.message?.includes('overloaded')) {
          throw new Error('The AI service is currently overloaded. Please try again in a few moments.');
      }
      throw new Error(`Failed to generate plan due to an AI error: ${error.message}`);
  }


  // Check if external information is needed
  if (initialPlan.requiresExternalInfo) {
     try {
        //Get search results
        const searchResults = await getSearchResults({query: {query: input.prompt}});
        //Update the plan with the search results
        initialPlan.plan += `\n Adding information from search results: ${searchResults.snippets.join('\n')}`;
     } catch (searchError: any) {
        console.warn("Failed to get search results:", searchError);
        // Optionally append a note to the plan that search failed
        initialPlan.plan += '\n (Note: Failed to retrieve external information)';
     }
  }

  return initialPlan;
});

