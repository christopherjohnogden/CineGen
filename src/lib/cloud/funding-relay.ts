import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { cloudDb, cloudFunctions, waitForCloudAuth } from './firebase';
import { getProjectFundingStatus, type WorkflowRunParams } from './funding';

const activeJobs = new Set<string>();

export async function startOwnerFundingRelay(projectId: string): Promise<() => void> {
  const user = await waitForCloudAuth();
  if (!user) return () => {};
  const status = await getProjectFundingStatus(projectId);
  if (status.ownerId !== user.uid || !status.enabled || !status.providers.includes('higgsfield')) return () => {};

  const claim = httpsCallable<{ jobId: string }, { projectId: string; params: WorkflowRunParams }>(cloudFunctions, 'claimFundedRelayJob');
  const complete = httpsCallable<{ jobId: string; result?: unknown; error?: string }, { ok: boolean }>(cloudFunctions, 'completeFundedRelayJob');
  return onSnapshot(query(
    collection(cloudDb, 'projectFundingJobs'),
    where('projectId', '==', projectId),
  ), (snapshot) => {
    for (const change of snapshot.docChanges()) {
      const jobId = change.doc.id;
      const data = change.doc.data();
      if (data.status !== 'pending' || data.provider !== 'higgsfield' || activeJobs.has(jobId)) continue;
      activeJobs.add(jobId);
      void (async () => {
        try {
          const claimed = (await claim({ jobId })).data;
          const result = await window.electronAPI.workflow.run(claimed.params);
          await complete({ jobId, result });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'The owner’s Higgsfield generation failed.';
          await complete({ jobId, error: message }).catch(() => {});
        } finally {
          activeJobs.delete(jobId);
        }
      })();
    }
  });
}
