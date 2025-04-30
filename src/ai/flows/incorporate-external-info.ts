'use server';

/**
 * @fileOverview A Genkit flow that incorporates external information into the plan when needed.
 *
 * - incorporateExternalInfo - A function that handles the process of incorporating external information into the plan.
 * - IncorporateExternalInfoInput - The input type for the incorporateExternalInfo function.
 * - IncorporateExternalInfoOutput - The return type for the incorporateExternalInfo function.
 */

import {ai} from '@/ai/ai-instance';
import {z} from 'genkit';
import {getSearchResults, SearchQuery, SearchResults} from '@/services/google-grounding';

const IncorporateExternalInfoInputSchema = z.object({
  prompt: z.string().describe('The user prompt.'),
  files: z.array(z.string()).optional().describe('List of file names uploaded by the user.'),
});
export type IncorporateExternalInfoInput = z.infer<typeof IncorporateExternalInfoInputSchema>;

const IncorporateExternalInfoOutputSchema = z.object({
  plan: z.string().describe('The detailed plan of action, incorporating external information if needed.'),
  requiresExternalInfo: z.boolean().describe('Whether the plan requires external information.'),
});
export type IncorporateExternalInfoOutput = z.infer<typeof IncorporateExternalInfoOutputSchema>;

export async function incorporateExternalInfo(input: IncorporateExternalInfoInput): Promise<IncorporateExternalInfoOutput> {
  return incorporateExternalInfoFlow(input);
}

const needsExternalInfoPrompt = ai.definePrompt({
  name: 'needsExternalInfoPrompt',
  input: {
    schema: z.object({
      prompt: z.string().describe('The user prompt.'),
      files: z.array(z.string()).optional().describe('List of file names uploaded by the user.'),
    }),
  },
  output: {
    schema: z.object({
      requiresExternalInfo: z.boolean().describe('Whether the prompt requires external information.'),
      searchQuery: z.string().optional().describe('The search query to use if external information is required.'),
    }),
  },
  prompt: `Determine if the following prompt requires external information to generate a comprehensive plan.  If it does, also generate a search query to obtain relevant information.

Prompt: {{{prompt}}}
Files: {{#if files}}{{{files}}}{{else}}No files uploaded{{/if}}

Respond with a JSON object containing:
- requiresExternalInfo: true if external information is needed, false otherwise.
- searchQuery: The search query to use if requiresExternalInfo is true. Otherwise, this field should be omitted.

Example when external information is needed:
{
  "requiresExternalInfo": true,
  "searchQuery": "current stock price of Google"
}

Example when external information is not needed:
{
  "requiresExternalInfo": false
}`,
});

const generatePlanPrompt = ai.definePrompt({
  name: 'generatePlanPrompt',
  input: {
    schema: z.object({
      prompt: z.string().describe('The user prompt.'),
      searchResults: z.string().optional().describe('Search results to incorporate into the plan.'),
      files: z.array(z.string()).optional().describe('List of file names uploaded by the user.'),
    }),
  },
  output: {
    schema: z.object({
      plan: z.string().describe('The detailed plan of action.'),
    }),
  },
  prompt: `Generate a detailed plan of action to fulfill the following prompt. Incorporate the provided search results if available.

Prompt: {{{prompt}}}
{{#if searchResults}}Search Results: {{{searchResults}}}{{/if}}
Files: {{#if files}}{{{files}}}{{else}}No files uploaded{{/if}}

Plan:`,
});

const incorporateExternalInfoFlow = ai.defineFlow<
  typeof IncorporateExternalInfoInputSchema,
  typeof IncorporateExternalInfoOutputSchema
>(
  {
    name: 'incorporateExternalInfoFlow',
    inputSchema: IncorporateExternalInfoInputSchema,
    outputSchema: IncorporateExternalInfoOutputSchema,
  },
  async input => {
    const {
      output: {requiresExternalInfo, searchQuery},
    } = await needsExternalInfoPrompt(input);

    let searchResults = undefined;
    if (requiresExternalInfo && searchQuery) {
      const results: SearchResults = await getSearchResults({query: searchQuery});
      searchResults = results.snippets.join('\n');
    }

    const {output} = await generatePlanPrompt({
      prompt: input.prompt,
      searchResults: searchResults,
      files: input.files,
    });

    return {
      plan: output!.plan,
      requiresExternalInfo: requiresExternalInfo,
    };
  }
);
