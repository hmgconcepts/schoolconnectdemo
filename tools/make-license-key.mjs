#!/usr/bin/env node
/* ============================================================================
   HMG activation-key generator (V9.1 enterprise subscription)
   ----------------------------------------------------------------------------
   Run at HMG (never ship to clients with the salt filled in):

     node tools/make-license-key.mjs --salt "THE SITE'S SECRET SALT" \
       --expires 2027-01-31 [--grace 7] [--status active|suspended] \
       [--plan "Termly plan"] [--cycle termly] [--renew-url https://wa.me/...] \
       [--lock-message "..."]

   Output: SC1.<base64url(payload)>.<hex sha256(payload_b64 + '.' + salt)>
   The client pastes the key on license.html → "Activation key". The server
   (sc_license_apply) recomputes the signature with the salt stored in
   sc_private.license_secret; a wrong salt or edited payload is rejected, and
   each key can be used exactly once (event log replay check).
   ============================================================================ */
import crypto from 'node:crypto';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) { args[a.slice(2)] = process.argv[i + 1]; i++; }
}
if (!args.salt || (!args.expires && args.model !== 'lifetime')) {
  console.error('Usage: node tools/make-license-key.mjs --salt "SECRET" --expires YYYY-MM-DD [--model subscription|lifetime] [--grace 7] [--status active|suspended] [--plan ...] [--cycle ...] [--renew-url ...] [--lock-message ...]');
  console.error('  Lifetime conversion: node tools/make-license-key.mjs --salt "SECRET" --model lifetime');
  process.exit(1);
}
if (args.expires && !/^\d{4}-\d{2}-\d{2}$/.test(args.expires)) { console.error('--expires must be YYYY-MM-DD'); process.exit(1); }
if (args.model === 'lifetime' && !args.expires) args.expires = '2099-12-31'; // ignored for lifetime, kept for payload shape

const payload = {
  /* V9.9 (#8): --model lifetime converts a subscription client to one-time
     ownership with a signed key — no database access needed at the school. */
  model: args.model === 'lifetime' ? 'lifetime' : 'subscription',
  expires_on: args.expires,
  grace_days: args.grace != null ? Math.max(0, parseInt(args.grace, 10) || 0) : 7,
  status: args.status === 'suspended' ? 'suspended' : 'active',
  nonce: crypto.randomBytes(8).toString('hex')   // makes every key unique → single-use
};
if (args.plan) payload.plan = args.plan;
if (args.cycle) payload.cycle = args.cycle;
if (args['renew-url']) payload.renew_url = args['renew-url'];
if (args['lock-message']) payload.lock_message = args['lock-message'];

const b64 = Buffer.from(JSON.stringify(payload)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sig = crypto.createHash('sha256').update(b64 + '.' + args.salt).digest('hex');
const key = `SC1.${b64}.${sig}`;

console.log('\nActivation key (send this to the school):\n');
console.log(key);
console.log('\nPayload:', JSON.stringify(payload, null, 2));
