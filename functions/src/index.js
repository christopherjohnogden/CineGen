import crypto from 'node:crypto';
import { createFalClient } from '@fal-ai/client';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

initializeApp();

const db = getFirestore();
const fundingMasterKey = defineSecret('OWNER_FUNDING_MASTER_KEY');
const REGION = 'us-central1';
const MAX_INPUT_BYTES = 900_000;
const MAX_RESULT_BYTES = 8_000_000;
const MIN_MONTHLY_LIMIT = 1;
const MAX_MONTHLY_LIMIT = 500;
const PROVIDERS = new Set(['fal', 'higgsfield']);

function requireAuth(request) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to CineGen Cloud first.');
  return request.auth.uid;
}

function requiredText(value, label, maxLength = 512) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new HttpsError('invalid-argument', `${label} is invalid.`);
  }
  return value.trim();
}

function projectIdFrom(value) {
  return requiredText(value, 'Project id', 160);
}

function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

async function accessFor(projectId, uid) {
  const snapshot = await db.doc(`projectAccess/${projectId}`).get();
  if (!snapshot.exists) throw new HttpsError('not-found', 'Project access was not found.');
  const access = snapshot.data();
  let role = access?.members?.[uid];
  if (role !== 'owner' && role !== 'editor' && typeof access?.teamId === 'string' && access.teamId) {
    const teamSnapshot = await db.doc(`teams/${access.teamId}`).get();
    role = teamSnapshot.data()?.members?.[uid];
  }
  if (role !== 'owner' && role !== 'editor') {
    throw new HttpsError('permission-denied', 'You do not have access to this team project.');
  }
  return { ...access, role };
}

function masterKey() {
  const raw = fundingMasterKey.value();
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length !== 32) throw new HttpsError('failed-precondition', 'Owner funding encryption is not configured.');
  return decoded;
}

function encryptCredential(projectId, provider, credential) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  cipher.setAAD(Buffer.from(`${projectId}:${provider}`));
  const ciphertext = Buffer.concat([cipher.update(credential, 'utf8'), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function decryptCredential(projectId, provider, encrypted) {
  if (!encrypted || encrypted.version !== 1) throw new HttpsError('failed-precondition', `${provider} funding is not configured.`);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(encrypted.iv, 'base64'));
    decipher.setAAD(Buffer.from(`${projectId}:${provider}`));
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new HttpsError('failed-precondition', `${provider} funding credentials could not be opened.`);
  }
}

function sanitizeForStorage(value, maxBytes = MAX_RESULT_BYTES) {
  const serialized = JSON.stringify(value ?? null);
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new HttpsError('resource-exhausted', 'The generation payload is too large.');
  }
  return JSON.parse(serialized);
}

function validateRemoteInputs(value) {
  const input = sanitizeForStorage(value, MAX_INPUT_BYTES);
  const serialized = JSON.stringify(input);
  if (/\b(?:file|local-media):\/\//i.test(serialized) || /"\/(?:Users|home|var|tmp)\//i.test(serialized)) {
    throw new HttpsError('invalid-argument', 'Owner-funded generations require cloud-hosted media inputs.');
  }
  return input;
}

async function fundingDocument(projectId) {
  const snapshot = await db.doc(`projectFundingSecrets/${projectId}`).get();
  return snapshot.exists ? snapshot.data() : null;
}

async function usageFor(projectId) {
  const month = monthKey();
  const snapshot = await db.doc(`projectFundingUsage/${projectId}_${month}`).get();
  return { month, used: Number(snapshot.data()?.used ?? 0) };
}

export const getProjectFundingStatus = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const projectId = projectIdFrom(request.data?.projectId);
  const access = await accessFor(projectId, uid);
  const [funding, usage] = await Promise.all([fundingDocument(projectId), usageFor(projectId)]);
  const providers = [];
  if (funding?.credentials?.fal) providers.push('fal');
  if (funding?.higgsfieldRelay === true) providers.push('higgsfield');
  return {
    enabled: funding?.enabled === true,
    providers,
    monthlyLimit: Number(funding?.monthlyLimit ?? 25),
    used: usage.used,
    month: usage.month,
    role: access.role,
    ownerId: access.ownerId,
  };
});

export const configureProjectFunding = onCall(
  { region: REGION, secrets: [fundingMasterKey] },
  async (request) => {
    const uid = requireAuth(request);
    const projectId = projectIdFrom(request.data?.projectId);
    const access = await accessFor(projectId, uid);
    if (access.role !== 'owner' || access.ownerId !== uid) {
      throw new HttpsError('permission-denied', 'Only the original project owner can fund generations.');
    }

    const current = await fundingDocument(projectId) ?? {};
    const enabled = request.data?.enabled === true;
    const monthlyLimit = Math.max(
      MIN_MONTHLY_LIMIT,
      Math.min(MAX_MONTHLY_LIMIT, Math.round(Number(request.data?.monthlyLimit) || 25)),
    );
    const credentials = { ...(current.credentials ?? {}) };
    const falKey = typeof request.data?.falKey === 'string' ? request.data.falKey.trim() : '';
    if (falKey) credentials.fal = encryptCredential(projectId, 'fal', falKey);
    if (request.data?.shareFal === false) delete credentials.fal;
    const higgsfieldRelay = request.data?.higgsfieldRelay === true;

    if (enabled && !credentials.fal && !higgsfieldRelay) {
      throw new HttpsError('failed-precondition', 'Choose fal.ai or the Higgsfield desktop relay before enabling funding.');
    }

    await db.doc(`projectFundingSecrets/${projectId}`).set({
      ownerId: uid,
      enabled,
      monthlyLimit,
      credentials,
      higgsfieldRelay,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true };
  },
);

async function reserveGeneration({ projectId, uid, provider, modelId, nodeType }) {
  const month = monthKey();
  const usageRef = db.doc(`projectFundingUsage/${projectId}_${month}`);
  const fundingRef = db.doc(`projectFundingSecrets/${projectId}`);
  const jobRef = db.collection('projectFundingJobs').doc();
  await db.runTransaction(async (transaction) => {
    const [fundingSnapshot, usageSnapshot] = await Promise.all([
      transaction.get(fundingRef),
      transaction.get(usageRef),
    ]);
    const funding = fundingSnapshot.data();
    if (!funding?.enabled) throw new HttpsError('failed-precondition', 'Owner-funded generation is turned off for this project.');
    const limit = Number(funding.monthlyLimit ?? 25);
    const used = Number(usageSnapshot.data()?.used ?? 0);
    if (used >= limit) throw new HttpsError('resource-exhausted', 'This project has reached its owner-funded monthly generation limit.');
    transaction.set(usageRef, {
      projectId,
      month,
      used: used + 1,
      byMember: { ...(usageSnapshot.data()?.byMember ?? {}), [uid]: Number(usageSnapshot.data()?.byMember?.[uid] ?? 0) + 1 },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(jobRef, {
      projectId,
      requestedBy: uid,
      provider,
      modelId,
      nodeType,
      status: provider === 'higgsfield' ? 'pending' : 'running',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return jobRef;
}

export const runFundedGeneration = onCall(
  { region: REGION, timeoutSeconds: 540, memory: '1GiB', secrets: [fundingMasterKey] },
  async (request) => {
    const uid = requireAuth(request);
    const projectId = projectIdFrom(request.data?.projectId);
    const provider = requiredText(request.data?.provider, 'Provider', 32);
    if (!PROVIDERS.has(provider)) throw new HttpsError('invalid-argument', 'That provider is not supported for owner funding.');
    await accessFor(projectId, uid);
    const params = request.data?.params ?? {};
    const modelId = requiredText(params.modelId, 'Model id', 300);
    const nodeType = requiredText(params.nodeType, 'Node type', 160);
    const inputs = validateRemoteInputs(params.inputs ?? {});
    const funding = await fundingDocument(projectId);
    if (!funding?.enabled) throw new HttpsError('failed-precondition', 'Owner funding is not enabled for this project.');
    if (provider === 'fal' && !funding.credentials?.fal) throw new HttpsError('failed-precondition', 'The owner has not shared a fal.ai key for this project.');
    if (provider === 'higgsfield' && funding.higgsfieldRelay !== true) throw new HttpsError('failed-precondition', 'The owner has not enabled the Higgsfield relay for this project.');

    const jobRef = await reserveGeneration({ projectId, uid, provider, modelId, nodeType });
    if (provider === 'higgsfield') {
      await jobRef.set({ params: { ...params, inputs }, relayExpiresAt: new Date(Date.now() + 15 * 60_000) }, { merge: true });
      return { pendingRelay: true, jobId: jobRef.id };
    }

    try {
      if (!/^fal-ai\/[A-Za-z0-9._/-]+$/.test(modelId)) {
        throw new HttpsError('invalid-argument', 'Only fal.ai generation models can use the funded fal.ai key.');
      }
      const credential = decryptCredential(projectId, 'fal', funding.credentials.fal);
      const client = createFalClient({ credentials: credential });
      const response = await client.subscribe(modelId, { input: inputs, logs: false });
      const result = sanitizeForStorage(response?.data ?? response);
      await jobRef.set({ status: 'complete', result, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { result };
    } catch (error) {
      await jobRef.set({
        status: 'error',
        error: error instanceof Error ? error.message.slice(0, 1000) : 'Generation failed.',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('internal', error instanceof Error ? error.message : 'Owner-funded generation failed.');
    }
  },
);

export const claimFundedRelayJob = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const jobId = requiredText(request.data?.jobId, 'Job id', 160);
  const jobRef = db.doc(`projectFundingJobs/${jobId}`);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    if (!snapshot.exists) throw new HttpsError('not-found', 'Generation request was not found.');
    const job = snapshot.data();
    const access = await accessFor(job.projectId, uid);
    if (access.ownerId !== uid) throw new HttpsError('permission-denied', 'Only the project owner can run this relay job.');
    if (job.status !== 'pending') throw new HttpsError('aborted', 'This relay job was already claimed.');
    transaction.update(jobRef, { status: 'running', claimedBy: uid, updatedAt: FieldValue.serverTimestamp() });
  });
  const job = (await jobRef.get()).data();
  return { projectId: job.projectId, params: job.params };
});

export const completeFundedRelayJob = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const jobId = requiredText(request.data?.jobId, 'Job id', 160);
  const jobRef = db.doc(`projectFundingJobs/${jobId}`);
  const snapshot = await jobRef.get();
  if (!snapshot.exists) throw new HttpsError('not-found', 'Generation request was not found.');
  const job = snapshot.data();
  const access = await accessFor(job.projectId, uid);
  if (access.ownerId !== uid || job.claimedBy !== uid) throw new HttpsError('permission-denied', 'This relay job belongs to another owner.');
  const error = typeof request.data?.error === 'string' ? request.data.error.slice(0, 1000) : '';
  const result = error ? null : sanitizeForStorage(request.data?.result);
  await jobRef.set({
    status: error ? 'error' : 'complete',
    ...(error ? { error } : { result }),
    params: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { ok: true };
});
