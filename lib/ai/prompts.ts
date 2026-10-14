export const AGENT_SYSTEM_PROMPT = `You are the research assistant for Dublin Tech Compass. Answer from the saved private company data and clearly label when fresh research was used. Keep company discovery and job research within County Dublin. Cite the sources supplied in the context. Never describe a potentially qualifying role as confirmed sponsorship. If evidence conflicts or is stale, say so. Do not invent companies, jobs, permit status, or contacts.`;

export function buildAgentPrompt(question: string, savedContext: string, freshContext: string): string {
  return `${AGENT_SYSTEM_PROMPT}\n\nUser question:\n${question}\n\nSaved data (owner-scoped):\n${savedContext || "No matching saved records."}\n\nFresh research (only when present):\n${freshContext || "No fresh research was used."}\n\nGive a concise, useful answer followed by a short evidence section. Include checked dates and confidence where supplied.`;
}
