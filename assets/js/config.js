/*
 * Site configuration.
 *
 * leadEndpoint — where the Get Started intake POSTs its answers (JSON).
 * ⚠️ NOT CONFIGURED YET. Until this is set, the intake runs end-to-end for the
 * visitor but the collected lead is not sent anywhere. Point it at a CRM
 * webhook, a form service (Formspree, Basin, etc.), a Google Apps Script
 * web app, or your own API.
 *
 * Payload shape:
 *   { name, business, businessType, location, problem, email, phone,
 *     source: "website-intake", submittedAt: ISO-8601 string }
 */
window.FRONTDESK_CONFIG = {
  leadEndpoint: ''
};
