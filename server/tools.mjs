// The Assistant's one tool: capture_lead. Shared between the Node server
// (server/handlers.mjs) and the Cloudflare Pages Functions (functions/api/chat.js) so
// both runtimes call OpenAI with the exact same tool definition and handle the result
// the exact same way.
import { normaliseLead, isValidEmail, deliverLead } from './leads.mjs';

export const tools = [{
  type: 'function',
  function: {
    name: 'capture_lead',
    description: 'Send a visitor\'s contact details to the FrontDesk team so a person follows up. Call once, only after the visitor has given at least their name and email.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string', description: 'Optional' },
        business: { type: 'string', description: 'Business name, if given' },
        package: { type: 'string', description: 'AEO, Assistant, Receptionist, or unsure' },
        need: { type: 'string', description: 'One-line summary of what they need' }
      },
      required: ['name', 'email', 'need']
    }
  }
}];

// webhookUrl passed explicitly — see server/leads.mjs for why (no process.env in Workers).
export async function runTool(call, webhookUrl) {
  if (call.name !== 'capture_lead') return { ok: false, error: 'unknown tool' };
  let args = {};
  try { args = JSON.parse(call.arguments || '{}'); } catch { return { ok: false, error: 'invalid arguments' }; }
  if (!isValidEmail(args.email)) return { ok: false, error: 'The email address looks incomplete. Ask the visitor to check it.' };
  try {
    await deliverLead(normaliseLead(args, 'ask-frontdesk-chat'), webhookUrl);
    return { ok: true };
  } catch (e) {
    console.error('[lead] delivery failed:', e.message);
    return { ok: false, error: 'Could not send right now. Apologise briefly and suggest using Get Started on the pricing page.' };
  }
}
