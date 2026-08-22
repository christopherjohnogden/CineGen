import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { cloudAuth } from '@/lib/cloud/firebase';
import { isCloudProjectId, promoteLocalProject } from '@/lib/cloud/projects';
import {
  getProjectCollaboration,
  inviteProjectCollaborator,
  removeProjectCollaborator,
  setProjectCollaboratorRole,
  type ProjectAccess,
  type ProjectRole,
} from '@/lib/cloud/collaboration';
import {
  configureProjectFunding,
  getProjectFundingStatus,
  type ProjectFundingStatus,
} from '@/lib/cloud/funding';
import { getApiKey } from '@/lib/utils/api-key';

export function useCloudUser(): User | null | undefined {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => onAuthStateChanged(cloudAuth, setUser), []);
  return user;
}

function friendlyAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Cloud sign-in failed.';
  if (message.includes('invalid-credential')) return 'That email or password is incorrect.';
  if (message.includes('email-already-in-use')) return 'An account already exists for that email.';
  if (message.includes('weak-password')) return 'Use a password with at least 6 characters.';
  if (message.includes('invalid-email')) return 'Enter a valid email address.';
  return message.replace(/^Firebase:\s*/i, '');
}

function CloudAuthDialog({ onClose }: { onClose: () => void }) {
  const user = useCloudUser();
  const [mode, setMode] = useState<'signin' | 'create'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      if (mode === 'create') {
        try {
          await createUserWithEmailAndPassword(cloudAuth, email.trim(), password);
        } catch (cause) {
          // A lost response can report a network error after Firebase already
          // created the account. A sign-in retry makes that case seamless.
          if (cause instanceof Error && cause.message.includes('network-request-failed')) {
            await signInWithEmailAndPassword(cloudAuth, email.trim(), password);
          } else {
            throw cause;
          }
        }
      } else {
        await signInWithEmailAndPassword(cloudAuth, email.trim(), password);
      }
      onClose();
    } catch (cause) {
      setError(friendlyAuthError(cause));
    } finally {
      setBusy(false);
    }
  }, [email, mode, onClose, password]);

  return (
    <div className="cloud-auth__backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="cloud-auth__dialog" role="dialog" aria-modal="true" aria-label="CineGen Cloud account">
        <div className="cloud-auth__header">
          <div>
            <h2>CineGen Cloud</h2>
            <p>One account keeps project data in sync across desktop and web.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        {user ? (
          <div className="cloud-auth__signed-in">
            <span className="cloud-auth__status-dot" />
            <div><strong>Cloud sync is connected</strong><span>{user.email}</span></div>
            <button type="button" className="sp-btn sp-btn--muted" onClick={() => void signOut(cloudAuth)}>Sign out</button>
          </div>
        ) : (
          <>
            <div className="cloud-auth__mode">
              <button className={mode === 'signin' ? 'is-active' : ''} onClick={() => setMode('signin')}>Sign in</button>
              <button className={mode === 'create' ? 'is-active' : ''} onClick={() => setMode('create')}>Create account</button>
            </div>
            <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
            <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'create' ? 'new-password' : 'current-password'} onKeyDown={(event) => event.key === 'Enter' && void submit()} /></label>
            {error && <p className="cloud-auth__error">{error}</p>}
            <button type="button" className="cloud-auth__submit" disabled={busy || !email.trim() || password.length < 6} onClick={() => void submit()}>
              {busy ? 'Connecting…' : mode === 'create' ? 'Create account' : 'Sign in'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function CloudAccountButton({ onAccountChange }: { onAccountChange?: () => void }) {
  const user = useCloudUser();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (user !== undefined) onAccountChange?.(); }, [onAccountChange, user]);
  return (
    <>
      <button type="button" className={`pm-cloud-btn${user ? ' pm-cloud-btn--connected' : ''}`} onClick={() => setOpen(true)}>
        <span className="pm-cloud-btn__dot" />
        {user ? 'Cloud synced' : 'Cloud sign in'}
      </button>
      {open && <CloudAuthDialog onClose={() => setOpen(false)} />}
    </>
  );
}

const roleOptions: Array<{ value: ProjectRole; label: string; description: string }> = [
  { value: 'editor', label: 'Editor', description: 'Can edit project and media' },
  { value: 'owner', label: 'Owner', description: 'Can manage people and delete' },
];

function RoleDropdown({
  value,
  disabled = false,
  ariaLabel,
  onChange,
}: {
  value: ProjectRole;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (role: ProjectRole) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = roleOptions.find((option) => option.value === value) ?? roleOptions[0];

  useEffect(() => {
    if (!open) return;

    const focusFrame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    });
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const selectRole = (role: ProjectRole) => {
    if (role !== value) onChange(role);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className={`cloud-role-select${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="cloud-role-select__trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        <span>{selected.label}</span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4.5 6 3.5 3.5L11.5 6" />
        </svg>
      </button>
      {open && (
        <div
          className="cloud-role-select__menu"
          role="listbox"
          aria-label={ariaLabel}
          ref={menuRef}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            const options = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
            const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
            const step = event.key === 'ArrowDown' ? 1 : -1;
            options[(currentIndex + step + options.length) % options.length]?.focus();
          }}
        >
          <span className="cloud-role-select__eyebrow">Project access</span>
          {roleOptions.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              key={option.value}
              onClick={() => selectRole(option.value)}
            >
              <span className="cloud-role-select__option-copy">
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
              <span className="cloud-role-select__check" aria-hidden="true">
                {option.value === value && (
                  <svg viewBox="0 0 16 16"><path d="m3.5 8.2 2.8 2.8 6.2-6.2" /></svg>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OwnerFundingPanel({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [status, setStatus] = useState<ProjectFundingStatus | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [shareFal, setShareFal] = useState(false);
  const [higgsfieldRelay, setHiggsfieldRelay] = useState(false);
  const [monthlyLimit, setMonthlyLimit] = useState(25);
  const [higgsfieldConnected, setHiggsfieldConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await getProjectFundingStatus(projectId);
      setStatus(next);
      setEnabled(next.enabled);
      setShareFal(next.providers.includes('fal'));
      setHiggsfieldRelay(next.providers.includes('higgsfield'));
      setMonthlyLimit(next.monthlyLimit);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load owner funding.');
    }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    let cancelled = false;
    window.electronAPI.higgsfield.accountStatus().then((account) => {
      if (!cancelled) setHiggsfieldConnected(Boolean(account.connected));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const save = async () => {
    const localFalKey = getApiKey();
    if (enabled && shareFal && !localFalKey && !status?.providers.includes('fal')) {
      setError('Add your fal.ai key in Settings before sharing it with this project.');
      return;
    }
    if (enabled && higgsfieldRelay && !higgsfieldConnected) {
      setError('Connect Higgsfield on this desktop before enabling its relay.');
      return;
    }
    setBusy(true);
    setSaved(false);
    setError('');
    try {
      await configureProjectFunding({
        projectId,
        enabled,
        monthlyLimit,
        shareFal,
        falKey: shareFal ? localFalKey : undefined,
        higgsfieldRelay,
      });
      await refresh();
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Owner funding could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  if (!status && !error) {
    return <div className="cloud-funding cloud-funding--loading"><span /><span /></div>;
  }

  if (!canManage) {
    return (
      <div className="cloud-funding">
        <div className="cloud-funding__summary">
          <div>
            <strong>Owner-funded generation</strong>
            <span>{status?.enabled ? 'Available for this project' : 'Not enabled for this project'}</span>
          </div>
          <span className={`cloud-funding__state${status?.enabled ? ' is-on' : ''}`}>{status?.enabled ? 'Funded' : 'Off'}</span>
        </div>
        {status?.enabled && (
          <>
            <p className="cloud-funding__usage">
              {status.used} of {status.monthlyLimit} funded requests used this month · {status.providers.map((provider) => provider === 'fal' ? 'fal.ai' : 'Higgsfield').join(' + ')}
            </p>
            <p className="cloud-funding__usage">Used automatically when you do not have your own provider connected.</p>
          </>
        )}
        {error && <p className="cloud-funding__error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="cloud-funding">
      <div className="cloud-funding__summary">
        <div>
          <strong>Owner-funded generation</strong>
          <span>Your brother can generate only inside this shared project.</span>
        </div>
        <button
          type="button"
          className={`cloud-funding__switch${enabled ? ' is-on' : ''}`}
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled((current) => !current)}
        ><span /></button>
      </div>

      <div className={`cloud-funding__controls${enabled ? '' : ' is-disabled'}`}>
        <button type="button" className={`cloud-funding__provider${shareFal ? ' is-selected' : ''}`} onClick={() => setShareFal((current) => !current)} disabled={!enabled}>
          <span className="cloud-funding__provider-mark">F</span>
          <span><strong>fal.ai API</strong><small>{getApiKey() || status?.providers.includes('fal') ? 'Key protected on Firebase' : 'Add key in Settings first'}</small></span>
          <span className="cloud-funding__check" aria-hidden="true">{shareFal && <svg viewBox="0 0 16 16"><path d="m3.5 8.2 2.8 2.8 6.2-6.2" /></svg>}</span>
        </button>
        <button type="button" className={`cloud-funding__provider${higgsfieldRelay ? ' is-selected' : ''}`} onClick={() => setHiggsfieldRelay((current) => !current)} disabled={!enabled}>
          <span className="cloud-funding__provider-mark">H</span>
          <span><strong>Higgsfield relay</strong><small>{higgsfieldConnected ? 'Works while this project is open' : 'Connect Higgsfield on desktop'}</small></span>
          <span className="cloud-funding__check" aria-hidden="true">{higgsfieldRelay && <svg viewBox="0 0 16 16"><path d="m3.5 8.2 2.8 2.8 6.2-6.2" /></svg>}</span>
        </button>
        <label className="cloud-funding__limit">
          <span>Monthly funded requests</span>
          <input type="number" min="1" max="500" value={monthlyLimit} disabled={!enabled} onChange={(event) => setMonthlyLimit(Math.max(1, Math.min(500, Number(event.target.value) || 1)))} />
        </label>
      </div>

      <div className="cloud-funding__footer">
        <span>{status ? `${status.used} used in ${status.month}` : 'Usage loads after saving'}</span>
        <button type="button" className="sp-btn sp-btn--accent" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : saved ? 'Saved' : 'Save funding'}</button>
      </div>
      {error && <p className="cloud-funding__error">{error}</p>}
    </div>
  );
}

export function CloudAccountCard({ projectId, useSqlite }: { projectId?: string; useSqlite?: boolean }) {
  const user = useCloudUser();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(() => Boolean(projectId && isCloudProjectId(projectId)));
  const [error, setError] = useState('');
  const [mediaStatus, setMediaStatus] = useState('');
  const [collaboration, setCollaboration] = useState<ProjectAccess | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<ProjectRole>('editor');
  const [collaborationBusy, setCollaborationBusy] = useState(false);

  useEffect(() => {
    const onMediaStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ status?: string; completed?: number; total?: number; error?: string }>).detail;
      if (detail.status === 'uploading') {
        setMediaStatus(`Uploading media ${detail.completed ?? 0} of ${detail.total ?? 0}…`);
      } else if (detail.status === 'ready') {
        setMediaStatus('Original media is backed up and available on both apps.');
      } else if (detail.status === 'waiting') {
        setMediaStatus(detail.error ?? 'Media upload is waiting to retry.');
      }
    };
    window.addEventListener('cinegen:cloud-media-status', onMediaStatus);
    return () => window.removeEventListener('cinegen:cloud-media-status', onMediaStatus);
  }, []);

  const refreshCollaboration = useCallback(async () => {
    if (!projectId || !user || !synced) return;
    try {
      setCollaboration(await getProjectCollaboration(projectId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load project collaborators.');
    }
  }, [projectId, synced, user]);

  useEffect(() => { void refreshCollaboration(); }, [refreshCollaboration]);

  const enableSync = useCallback(async () => {
    if (!projectId) return;
    setSyncing(true);
    setError('');
    try {
      await promoteLocalProject(projectId, useSqlite ?? true);
      setSynced(true);
      window.setTimeout(() => void refreshCollaboration(), 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Project upload failed.');
    } finally {
      setSyncing(false);
    }
  }, [projectId, refreshCollaboration, useSqlite]);

  const invite = useCallback(async () => {
    if (!projectId || !user) return;
    setCollaborationBusy(true);
    setError('');
    try {
      setCollaboration(await inviteProjectCollaborator(projectId, user, inviteEmail, inviteRole));
      setInviteEmail('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The collaborator could not be invited.');
    } finally {
      setCollaborationBusy(false);
    }
  }, [inviteEmail, inviteRole, projectId, user]);

  const changeRole = useCallback(async (memberUid: string, role: ProjectRole) => {
    if (!projectId || !user) return;
    setCollaborationBusy(true);
    setError('');
    try {
      setCollaboration(await setProjectCollaboratorRole(projectId, user, memberUid, role));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The permission could not be changed.');
    } finally {
      setCollaborationBusy(false);
    }
  }, [projectId, user]);

  const removeMember = useCallback(async (memberUid: string) => {
    if (!projectId || !user) return;
    setCollaborationBusy(true);
    setError('');
    try {
      setCollaboration(await removeProjectCollaborator(projectId, user, memberUid));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The collaborator could not be removed.');
    } finally {
      setCollaborationBusy(false);
    }
  }, [projectId, user]);

  const currentRole = user ? collaboration?.members[user.uid] : undefined;

  return (
    <section className="sp-card" id="sp-section-cloud">
      <h3 className="sp-card__title">Cloud Account</h3>
      <p className="sp-card__desc">Project structure, scripts, shots, timelines, and edits sync through your private Firebase account. API keys stay on this device. Original media uploads automatically when Cloud Storage is available.</p>
      <div className="cloud-account-card__row">
        <div className="cloud-account-card__identity">
          <span className={`cloud-auth__status-dot${user ? ' is-connected' : ''}`} />
          <div><strong>{user ? 'Connected' : 'Not signed in'}</strong><span>{user?.email ?? 'Sign in to use projects on desktop and web.'}</span></div>
        </div>
        <button type="button" className="sp-btn sp-btn--muted" onClick={() => setDialogOpen(true)}>{user ? 'Account' : 'Sign in'}</button>
      </div>
      {user && projectId && (
        <div className="cloud-account-card__sync">
          <div><strong>{synced ? 'This project is syncing' : 'This project is local only'}</strong><span>{synced ? 'Changes save to Firebase automatically.' : 'Upload it once, then open it from either app.'}</span></div>
          {!synced && <button type="button" className="sp-btn sp-btn--accent" disabled={syncing} onClick={() => void enableSync()}>{syncing ? 'Uploading…' : 'Sync this project'}</button>}
        </div>
      )}
      {user && projectId && synced && collaboration && (
        <div className="cloud-collaboration">
          <div className="cloud-collaboration__heading">
            <div><strong>Project collaborators</strong><span>Your access: {currentRole ?? 'member'}</span></div>
          </div>
          <div className="cloud-collaboration__members">
            {collaboration.memberDetails.map((member) => (
              <div className="cloud-collaboration__member" key={member.uid}>
                <div><strong>{member.email || 'CineGen user'}</strong><span>{member.uid === collaboration.ownerId ? 'Original owner' : member.role}</span></div>
                {currentRole === 'owner' && member.uid !== collaboration.ownerId && (
                  <div className="cloud-collaboration__member-actions">
                    <RoleDropdown
                      value={member.role}
                      disabled={collaborationBusy}
                      ariaLabel={`Permission for ${member.email}`}
                      onChange={(role) => void changeRole(member.uid, role)}
                    />
                    <button type="button" className="cloud-collaboration__remove" disabled={collaborationBusy} onClick={() => void removeMember(member.uid)}>Remove</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {currentRole === 'owner' && (
            <div className="cloud-collaboration__invite">
              <input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="Collaborator email" aria-label="Collaborator email" />
              <RoleDropdown value={inviteRole} ariaLabel="Collaborator permission" onChange={setInviteRole} />
              <button type="button" className="sp-btn sp-btn--accent" disabled={collaborationBusy || !inviteEmail.trim()} onClick={() => void invite()}>{collaborationBusy ? 'Saving…' : 'Invite'}</button>
            </div>
          )}
          {currentRole === 'editor' && <p className="cloud-collaboration__note">Editors can change project content and media. Only owners can manage access or delete the project.</p>}
          {currentRole && <OwnerFundingPanel projectId={projectId} canManage={user.uid === collaboration.ownerId} />}
        </div>
      )}
      {mediaStatus && <p className="cloud-account-card__media-status">{mediaStatus}</p>}
      {error && <p className="sp-card__error">{error}</p>}
      {dialogOpen && <CloudAuthDialog onClose={() => setDialogOpen(false)} />}
    </section>
  );
}
