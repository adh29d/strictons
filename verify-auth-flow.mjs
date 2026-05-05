// One-off verification script for Phase 3 commit 8 (C1 + Q4).
// Calls supabase.auth.admin.generateLink to capture the response shape
// and to test whether a default magic-link email is sent.
//
// SAFE TO RUN: read-only against the auth admin API; does not write
// to the database; does not affect any user data.
//
// Delete this file after verification.

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const target = 'dev-test@strictons.com';

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY in env.');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log(`\nCalling supabase.auth.admin.generateLink for ${target}...\n`);
console.log(`Watch the dev-test@strictons.com inbox over the next 60 seconds.`);
console.log(`If Supabase's default magic-link email arrives, default-send IS happening.`);
console.log(`If no email arrives, default-send is NOT happening (this is what we want).\n`);

const { data, error } = await supabase.auth.admin.generateLink({
  type: 'magiclink',
  email: target,
  options: {
    redirectTo: 'https://partners.strictons.com/auth/confirm',
  },
});

if (error) {
  console.error('generateLink errored:');
  console.error(JSON.stringify(error, null, 2));
  process.exit(1);
}

// Mask the actual token values — we want shape, not secrets.
const masked = JSON.parse(JSON.stringify(data));
if (masked?.properties?.hashed_token) {
  masked.properties.hashed_token = `<MASKED ${data.properties.hashed_token.length}-char string>`;
}
if (masked?.properties?.email_otp) {
  masked.properties.email_otp = `<MASKED ${data.properties.email_otp.length}-char string>`;
}
if (masked?.properties?.action_link) {
  // Keep just the URL prefix and the param keys, not values
  try {
    const u = new URL(data.properties.action_link);
    const params = [...u.searchParams.keys()].join(', ');
    masked.properties.action_link = `${u.origin}${u.pathname}?<params: ${params}>`;
  } catch {
    masked.properties.action_link = '<could not parse>';
  }
}
if (masked?.user?.id) {
  masked.user.id = '<MASKED uuid>';
}
if (masked?.user?.email) {
  masked.user.email = `<the test email>`;
}

console.log('Response shape (values masked):');
console.log(JSON.stringify(masked, null, 2));
