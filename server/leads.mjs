// Lead delivery shared by the website intake (/api/lead) and the Assistant's
// capture_lead tool. Set LEAD_WEBHOOK_URL to a CRM / Zapier / Make / Google Apps Script
// webhook to receive leads as JSON. Without it, leads are only written to the server log.

const MAX = 500;
const clean = (v) => (typeof v === 'string' ? v.trim().slice(0, MAX) : '');

export function normaliseLead(input = {}, source = 'website') {
  const lead = {
    source,
    package: clean(input.package),
    name: clean(input.name),
    business: clean(input.business),
    businessType: clean(input.businessType),
    location: clean(input.location),
    problem: clean(input.problem),
    need: clean(input.need),
    email: clean(input.email),
    phone: clean(input.phone),
    submittedAt: new Date().toISOString()
  };
  for (const k of Object.keys(lead)) if (lead[k] === '') delete lead[k];
  return lead;
}

export function isValidEmail(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

export async function deliverLead(lead) {
  const url = process.env.LEAD_WEBHOOK_URL;
  if (!url) {
    console.warn('[lead] LEAD_WEBHOOK_URL is not set; lead logged only:', JSON.stringify(lead));
    return { delivered: false };
  }
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(lead)
  });
  if (!r.ok) throw new Error(`lead webhook responded ${r.status}`);
  return { delivered: true };
}
