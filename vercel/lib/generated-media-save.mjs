import { GeneratedMediaDownloadError, isTopviewSignedDownload, persistGeneratedMedia } from '../../shared/generated-media.mjs';

/** Authenticated server-to-server fallback for CloudFront blocking Worker egress. */
export async function saveGeneratedMediaOnNode(input, token, allowedEmails, firebaseKey) {
  const denied = (message, status = 403) => Object.assign(new Error(message), { status });
  if (typeof token !== 'string' || !/^[A-Za-z0-9_.-]{1,20000}$/.test(token)) throw denied('Sign in to CineGen.', 401);
  const { source, ownerId, projectId, assetId, type } = input ?? {};
  if (![ownerId, projectId, assetId].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value))
    || !['video', 'image'].includes(type) || !isTopviewSignedDownload(source)) throw denied('Invalid generated media transfer.', 400);
  const identity = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseKey}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: token }), signal: AbortSignal.timeout(15000),
  });
  const user = (await identity.json()).users?.[0];
  if (!identity.ok || !user?.localId || user.disabled || !allowedEmails.has(user.email?.toLowerCase())) throw denied('This CineGen account is not approved.');
  // Firestore and Storage both enforce the authenticated user's project access.
  // Do this before contacting the CDN, including for team-owned projects.
  const project = await fetch(`https://firestore.googleapis.com/v1/projects/cinegen-734ba/databases/(default)/documents/users/${ownerId}/projects/${projectId}`, {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
  });
  await project.body?.cancel();
  if (!project.ok) throw denied('Your CineGen account cannot access this project.');
  const url = await persistGeneratedMedia({ source, token, ownerId, projectId, assetId, type, provider: 'topview' }, async address => {
    if (!isTopviewSignedDownload(address)) throw denied('Invalid Topview download.', 400);
    // Preserve the signature and encoded path. Never follow a CDN redirect or
    // send the Firebase bearer token to Topview.
    const response = await fetch(address, { redirect: 'manual', signal: AbortSignal.timeout(180000) });
    if (!response.ok || !response.body) {
      await response.body?.cancel(); throw new GeneratedMediaDownloadError(response.status, new URL(address).hostname);
    }
    return response;
  });
  return { url };
}
