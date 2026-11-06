import { resendSignupVerification } from '../../server/auth.js';
import { rejectCrossOriginRequest } from '../../server/csrf.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('allow', 'POST');
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  if (rejectCrossOriginRequest(req, res)) return;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  try {
    const body = typeof req.body === 'object' && req.body ? req.body : {};
    await resendSignupVerification(body.email);
    res.statusCode = 200;
    return res.end(JSON.stringify({ sent: true }));
  } catch (error) {
    const status = Number(error.status) || 500;
    res.statusCode = status;
    return res.end(JSON.stringify({
      error: status === 500 ? 'Unable to resend the verification email. Please try again later.' : error.message,
    }));
  }
}
