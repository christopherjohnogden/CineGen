import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import { createUserWithEmailAndPassword, deleteUser, getAuth } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, getFirestore, query, setDoc, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

const firebaseConfig = {
  apiKey: 'AIzaSyDhxfLpKNqAMJWFCiUPaQiINUk2U2Wv9gA',
  authDomain: 'cinegen-734ba.firebaseapp.com',
  projectId: 'cinegen-734ba',
};
const projectId = `funding-smoke-${crypto.randomUUID()}`;
const password = `CineGen-${crypto.randomUUID()}!`;
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const apps = ['owner', 'editor', 'outsider'].map((role) => initializeApp(firebaseConfig, `${role}-${stamp}`));
const users = [];
const jobIds = [];

function call(app, name) {
  return httpsCallable(getFunctions(app, 'us-central1'), name, { timeout: 60_000 });
}

async function adminDelete(path) {
  execFileSync('npx', [
    'firebase', 'firestore:delete', path,
    '--force', '--project', 'cinegen-734ba',
  ], { stdio: 'ignore' });
}

try {
  for (let index = 0; index < apps.length; index += 1) {
    const credential = await createUserWithEmailAndPassword(
      getAuth(apps[index]),
      `cinegen-funding-${index}-${stamp}@example.com`,
      password,
    );
    users.push(credential.user);
  }
  const [owner, editor] = users;
  const ownerDb = getFirestore(apps[0]);
  await setDoc(doc(ownerDb, 'users', owner.uid, 'projects', projectId), { id: projectId, name: 'Funding smoke test' });
  await setDoc(doc(ownerDb, 'projectAccess', projectId), {
    projectId,
    ownerId: owner.uid,
    members: { [owner.uid]: 'owner' },
    memberIds: [owner.uid],
    memberDetails: [{ uid: owner.uid, email: owner.email, role: 'owner', addedAt: new Date().toISOString() }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await setDoc(doc(ownerDb, 'projectAccess', projectId), {
    members: { [owner.uid]: 'owner', [editor.uid]: 'editor' },
    memberIds: [owner.uid, editor.uid],
    memberDetails: [
      { uid: owner.uid, email: owner.email, role: 'owner', addedAt: new Date().toISOString() },
      { uid: editor.uid, email: editor.email, role: 'editor', addedAt: new Date().toISOString() },
    ],
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  await call(apps[0], 'configureProjectFunding')({
    projectId,
    enabled: true,
    monthlyLimit: 2,
    shareFal: false,
    higgsfieldRelay: true,
  });

  const editorStatus = (await call(apps[1], 'getProjectFundingStatus')({ projectId })).data;
  assert.equal(editorStatus.enabled, true);
  assert.equal(editorStatus.role, 'editor');
  assert.deepEqual(editorStatus.providers, ['higgsfield']);
  await assert.rejects(
    () => call(apps[1], 'configureProjectFunding')({ projectId, enabled: false, monthlyLimit: 2 }),
    /original project owner|permission/i,
  );

  await assert.rejects(
    () => call(apps[2], 'getProjectFundingStatus')({ projectId }),
    /access|permission/i,
  );
  await assert.rejects(
    () => getDoc(doc(getFirestore(apps[1]), 'projectFundingSecrets', projectId)),
    /permission/i,
  );

  const first = (await call(apps[1], 'runFundedGeneration')({
    projectId,
    provider: 'higgsfield',
    params: { nodeId: 'smoke', nodeType: 'hf-nano-banana-pro', modelId: 'nano_banana_2', inputs: { prompt: 'smoke test' } },
  })).data;
  assert.equal(first.pendingRelay, true);
  jobIds.push(first.jobId);

  const claim = (await call(apps[0], 'claimFundedRelayJob')({ jobId: first.jobId })).data;
  assert.equal(claim.projectId, projectId);
  await call(apps[0], 'completeFundedRelayJob')({ jobId: first.jobId, result: { images: [{ url: 'https://example.com/smoke.png' }] } });
  const completed = await getDoc(doc(getFirestore(apps[1]), 'projectFundingJobs', first.jobId));
  assert.equal(completed.data()?.status, 'complete');
  const ownerJobs = await getDocs(query(
    collection(ownerDb, 'projectFundingJobs'),
    where('projectId', '==', projectId),
  ));
  assert.equal(ownerJobs.docs.some((entry) => entry.id === first.jobId), true);

  const second = (await call(apps[1], 'runFundedGeneration')({
    projectId,
    provider: 'higgsfield',
    params: { nodeId: 'smoke-2', nodeType: 'hf-nano-banana-pro', modelId: 'nano_banana_2', inputs: { prompt: 'smoke test two' } },
  })).data;
  jobIds.push(second.jobId);
  await assert.rejects(
    () => call(apps[1], 'runFundedGeneration')({
      projectId,
      provider: 'higgsfield',
      params: { nodeId: 'smoke-3', nodeType: 'hf-nano-banana-pro', modelId: 'nano_banana_2', inputs: { prompt: 'over limit' } },
    }),
    /limit|resource-exhausted/i,
  );

  await call(apps[0], 'configureProjectFunding')({
    projectId,
    enabled: true,
    monthlyLimit: 2,
    shareFal: true,
    falKey: 'test-key-never-used',
    higgsfieldRelay: false,
  });
  const ownerStatus = (await call(apps[0], 'getProjectFundingStatus')({ projectId })).data;
  assert.deepEqual(ownerStatus.providers, ['fal']);
  await call(apps[0], 'configureProjectFunding')({
    projectId,
    enabled: true,
    monthlyLimit: 2,
    shareFal: false,
    higgsfieldRelay: true,
  });
  const removedKeyStatus = (await call(apps[0], 'getProjectFundingStatus')({ projectId })).data;
  assert.deepEqual(removedKeyStatus.providers, ['higgsfield']);

  console.log('Owner funding smoke test passed.');
} finally {
  await Promise.allSettled([
    ...jobIds.map((id) => adminDelete(`projectFundingJobs/${id}`)),
    adminDelete(`projectFundingSecrets/${projectId}`),
    adminDelete(`projectFundingUsage/${projectId}_${new Date().toISOString().slice(0, 7)}`),
  ]);
  if (users[0]) {
    await Promise.allSettled([
      deleteDoc(doc(getFirestore(apps[0]), 'projectAccess', projectId)),
      deleteDoc(doc(getFirestore(apps[0]), 'users', users[0].uid, 'projects', projectId)),
    ]);
  }
  await Promise.allSettled(users.map((user) => deleteUser(user)));
  await Promise.allSettled(apps.map((app) => deleteApp(app)));
}
