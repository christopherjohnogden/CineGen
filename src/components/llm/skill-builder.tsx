import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { SkillAuthoringPanel } from '@/components/llm/skill-authoring-panel';
import { saveSkillDraft, type ParsedSkillDraft } from '@/lib/llm/skill-authoring';
import type { CliLlmSessionState, CliLlmProviderId } from '@/lib/llm/claude-code-session';
import {
  createBlankSkill,
  createSkillFromTemplate,
  isSkillNameTaken,
  loadSkills,
  parseSkillFromMarkdown,
  saveSkills,
  serializeSkillToMarkdown,
  SKILL_TEMPLATES,
  updateSkillRecord,
  formatSkillSurfaces,
  type LLMSkill,
} from '@/lib/llm/skills';

type LLMMode = 'cloud' | 'local' | CliLlmProviderId;

interface CliProviderInfo {
  id: CliLlmProviderId;
  installed: boolean;
}

type EditorPanelMode = 'empty' | 'create-prompt' | 'authoring' | 'edit';

interface SkillBuilderProps {
  open: boolean;
  onClose: () => void;
  activeSkillId: string | null;
  onActiveSkillChange: (skillId: string | null) => void;
  mode: LLMMode;
  model: string;
  localModel: string;
  falKey?: string;
  cliProviders: Record<CliLlmProviderId, CliProviderInfo>;
  cliSession: CliLlmSessionState;
}

export function SkillBuilder({
  open,
  onClose,
  activeSkillId,
  onActiveSkillChange,
  mode,
  model,
  localModel,
  falKey,
  cliProviders,
  cliSession,
}: SkillBuilderProps) {
  const [skills, setSkills] = useState<LLMSkill[]>(() => loadSkills());
  const [selectedId, setSelectedId] = useState<string | null>(activeSkillId);
  const [draft, setDraft] = useState<LLMSkill | null>(null);
  const [saveError, setSaveError] = useState('');
  const [panelMode, setPanelMode] = useState<EditorPanelMode>('empty');
  const [createPrompt, setCreatePrompt] = useState('');
  const [authorSeed, setAuthorSeed] = useState('');

  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.id === selectedId) ?? null,
    [selectedId, skills],
  );

  const syncDraft = useCallback((skill: LLMSkill | null) => {
    setDraft(skill ? { ...skill } : null);
    setSaveError('');
    setPanelMode(skill ? 'edit' : 'empty');
  }, []);

  useEffect(() => {
    if (!open) return;
    const latest = loadSkills();
    setSkills(latest);
    const initial = latest.find((skill) => skill.id === activeSkillId) ?? latest[0] ?? null;
    setSelectedId(initial?.id ?? null);
    syncDraft(initial);
    setCreatePrompt('');
    setAuthorSeed('');
  }, [activeSkillId, open, syncDraft]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  const persistSkills = useCallback((next: LLMSkill[]) => {
    setSkills(next);
    saveSkills(next);
  }, []);

  const handleSelect = useCallback((skill: LLMSkill) => {
    setSelectedId(skill.id);
    syncDraft(skill);
    setCreatePrompt('');
    setAuthorSeed('');
  }, [syncDraft]);

  const handleStartCreate = useCallback(() => {
    setSelectedId(null);
    setDraft(null);
    setSaveError('');
    setCreatePrompt('');
    setAuthorSeed('');
    setPanelMode('create-prompt');
  }, []);

  const handleCreateBlank = useCallback(() => {
    const skill = createBlankSkill();
    const next = [...skills, skill];
    persistSkills(next);
    setSelectedId(skill.id);
    syncDraft(skill);
    setCreatePrompt('');
    setAuthorSeed('');
  }, [persistSkills, skills, syncDraft]);

  const handleCreateFromTemplate = useCallback((templateIndex: number) => {
    const template = SKILL_TEMPLATES[templateIndex];
    if (!template) return;
    const skill = createSkillFromTemplate(template);
    const next = [...skills, skill];
    persistSkills(next);
    setSelectedId(skill.id);
    syncDraft(skill);
  }, [persistSkills, skills, syncDraft]);

  const handleStartAuthoring = useCallback(() => {
    const seed = createPrompt.trim()
      ? `Help me create a Copilot skill for: ${createPrompt.trim()}`
      : 'Help me create a new Copilot skill. Ask me what you need to know.';
    setAuthorSeed(seed);
    setPanelMode('authoring');
  }, [createPrompt]);

  const handleAuthoringDraftReady = useCallback((parsed: ParsedSkillDraft) => {
    const skill = updateSkillRecord(createBlankSkill(), {
      name: parsed.name,
      description: parsed.description,
      instructions: parsed.instructions,
    });
    setDraft(skill);
    setPanelMode('edit');
  }, []);

  const handleSaveAuthoringDraft = useCallback((parsed: ParsedSkillDraft) => {
    const { skill } = saveSkillDraft(parsed);
    const next = [...skills, skill];
    persistSkills(next);
    setSelectedId(skill.id);
    syncDraft(skill);
    onActiveSkillChange(skill.id);
  }, [onActiveSkillChange, persistSkills, skills, syncDraft]);

  const handleSave = useCallback(() => {
    if (!draft) return;
    if (!draft.name.trim()) {
      setSaveError('Skill name is required.');
      return;
    }
    if (!draft.description.trim()) {
      setSaveError('Description is required — it tells Copilot when to use this skill.');
      return;
    }
    if (isSkillNameTaken(draft.name, skills, draft.id)) {
      setSaveError('Another skill already uses this name.');
      return;
    }

    const updated = updateSkillRecord(draft, {
      name: draft.name,
      description: draft.description,
      instructions: draft.instructions,
    });

    const exists = skills.some((skill) => skill.id === updated.id);
    const next = exists
      ? skills.map((skill) => (skill.id === updated.id ? updated : skill))
      : [...skills, updated];

    persistSkills(next);
    setSelectedId(updated.id);
    syncDraft(updated);
    setSaveError('');
  }, [draft, persistSkills, skills, syncDraft]);

  const handleDelete = useCallback(() => {
    if (!draft) return;
    if (draft.builtIn) {
      const ok = window.confirm(
        `"${draft.name}" is a built-in skill. Delete it anyway? It will be restored the next time skills load unless you create a custom skill with the same name.`,
      );
      if (!ok) return;
    }
    const next = skills.filter((skill) => skill.id !== draft.id);
    persistSkills(next);
    if (activeSkillId === draft.id) onActiveSkillChange(null);
    const fallback = next[0] ?? null;
    setSelectedId(fallback?.id ?? null);
    syncDraft(fallback);
  }, [activeSkillId, draft, onActiveSkillChange, persistSkills, skills, syncDraft]);

  const handleUseSkill = useCallback(() => {
    if (!draft) return;
    handleSave();
    onActiveSkillChange(draft.id);
    onClose();
  }, [draft, handleSave, onActiveSkillChange, onClose]);

  const handleExport = useCallback(async () => {
    if (!draft) return;
    const markdown = serializeSkillToMarkdown(draft);
    try {
      await navigator.clipboard.writeText(markdown);
    } catch {
      // ignore clipboard failures
    }
  }, [draft]);

  const handleImport = useCallback(() => {
    const raw = window.prompt('Paste SKILL.md content (YAML frontmatter + markdown body):');
    if (!raw?.trim()) return;
    try {
      const parsed = parseSkillFromMarkdown(raw.trim());
      const skill: LLMSkill = {
        ...parsed,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const next = [...skills, skill];
      persistSkills(next);
      setSelectedId(skill.id);
      syncDraft(skill);
    } catch {
      setSaveError('Could not parse SKILL.md content.');
    }
  }, [persistSkills, skills, syncDraft]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="copilot__skills" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="copilot__skills-panel">
        <div className="copilot__skills-header">
          <div className="copilot__skills-header-copy">
            <span className="copilot__skills-title">Skill Builder</span>
            <p className="copilot__skills-subtitle">
              Create reusable Copilot skills — like Claude skills — with instructions Copilot follows during chat.
            </p>
          </div>
          <button className="copilot__settings-close" onClick={onClose} aria-label="Close skill builder">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="copilot__skills-body">
          <aside className="copilot__skills-list-pane">
            <div className="copilot__skills-list-actions">
              <button type="button" className="copilot__skills-action" onClick={handleStartCreate}>New skill</button>
              <div className="copilot__skills-template-wrap">
                <select
                  className="copilot__skills-template-select"
                  defaultValue=""
                  onChange={(event) => {
                    const index = Number(event.target.value);
                    if (!Number.isFinite(index) || index < 0) return;
                    handleCreateFromTemplate(index);
                    event.target.value = '';
                  }}
                >
                  <option value="" disabled>From template…</option>
                  {SKILL_TEMPLATES.map((template, index) => (
                    <option key={template.name} value={index}>{template.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="copilot__skills-list">
              {skills.length === 0 && (
                <div className="copilot__skills-list-empty">No skills yet. Built-in defaults load automatically — or start from a template.</div>
              )}
              {skills.map((skill) => (
                <button
                  key={skill.id}
                  type="button"
                  className={`copilot__skills-list-item${selectedId === skill.id ? ' copilot__skills-list-item--active' : ''}${activeSkillId === skill.id ? ' copilot__skills-list-item--in-use' : ''}`}
                  onClick={() => handleSelect(skill)}
                >
                  <span className="copilot__skills-list-name">
                    {skill.name}
                    {skill.builtIn && <span className="copilot__skills-list-tag">Built-in</span>}
                  </span>
                  <span className="copilot__skills-list-desc">{skill.description}</span>
                  {skill.surfaces?.length ? (
                    <span className="copilot__skills-list-surfaces">{formatSkillSurfaces(skill.surfaces)}</span>
                  ) : null}
                  {activeSkillId === skill.id && <span className="copilot__skills-list-badge">Active</span>}
                </button>
              ))}
            </div>

            <div className="copilot__skills-list-footer">
              <button type="button" className="copilot__skills-link" onClick={handleImport}>Import SKILL.md</button>
            </div>
          </aside>

          <section className="copilot__skills-editor">
            {panelMode === 'create-prompt' && (
              <div className="copilot__skills-create">
                <span className="copilot__skills-create-title">New skill</span>
                <p className="copilot__skills-create-copy">
                  Optionally describe what you want — your installed CLI (or Cloud/Local fallback) will ask a few questions and draft the skill for you.
                </p>
                <label className="copilot__skills-field" htmlFor="skill-create-prompt">
                  <span className="copilot__settings-label">What should this skill do?</span>
                  <textarea
                    id="skill-create-prompt"
                    className="copilot__settings-textarea"
                    rows={4}
                    value={createPrompt}
                    onChange={(event) => setCreatePrompt(event.target.value)}
                    placeholder="e.g. Build shot lists from interview transcripts with coverage notes and duration estimates"
                  />
                </label>
                <div className="copilot__skills-create-actions">
                  <button type="button" className="copilot__btn copilot__btn--accent" onClick={handleStartAuthoring}>
                    Build with AI
                  </button>
                  <button type="button" className="copilot__btn copilot__btn--ghost" onClick={handleCreateBlank}>
                    Blank skill
                  </button>
                  <button type="button" className="copilot__btn copilot__btn--ghost" onClick={() => setPanelMode(selectedSkill ? 'edit' : 'empty')}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {panelMode === 'authoring' && (
              <SkillAuthoringPanel
                key={authorSeed}
                seedPrompt={authorSeed}
                mode={mode}
                model={model}
                localModel={localModel}
                falKey={falKey}
                cliProviders={cliProviders}
                cliSession={cliSession}
                onDraftReady={handleAuthoringDraftReady}
                onCancel={() => setPanelMode('create-prompt')}
                showSaveButton
                onSave={handleSaveAuthoringDraft}
              />
            )}

            {panelMode === 'empty' && (
              <div className="copilot__skills-editor-empty">Select or create a skill to edit.</div>
            )}

            {panelMode === 'edit' && draft && (
              <>
                <div className="copilot__skills-field">
                  <label className="copilot__settings-label" htmlFor="skill-name">Name</label>
                  <input
                    id="skill-name"
                    className="copilot__settings-input"
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    placeholder="shot-list"
                  />
                  <span className="copilot__skills-hint">Lowercase letters, numbers, and hyphens — like Claude skill IDs.</span>
                </div>

                <div className="copilot__skills-field">
                  <label className="copilot__settings-label" htmlFor="skill-description">Description</label>
                  <textarea
                    id="skill-description"
                    className="copilot__settings-textarea"
                    rows={3}
                    value={draft.description}
                    onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                    placeholder="What this skill does and when Copilot should use it."
                  />
                </div>

                <div className="copilot__skills-field copilot__skills-field--grow">
                  <label className="copilot__settings-label" htmlFor="skill-instructions">Instructions</label>
                  <textarea
                    id="skill-instructions"
                    className="copilot__settings-textarea copilot__skills-instructions"
                    value={draft.instructions}
                    onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
                    placeholder="# Skill title&#10;&#10;Step-by-step guidance for Copilot…"
                  />
                </div>

                {saveError && <div className="copilot__alert copilot__alert--error copilot__alert--inline">{saveError}</div>}

                <div className="copilot__skills-editor-footer">
                  <div className="copilot__skills-editor-left">
                    <button type="button" className="copilot__btn copilot__btn--ghost" onClick={handleExport}>Copy SKILL.md</button>
                    <button type="button" className="copilot__btn copilot__btn--ghost copilot__btn--danger" onClick={handleDelete}>Delete</button>
                  </div>
                  <div className="copilot__skills-editor-right">
                    <button type="button" className="copilot__btn copilot__btn--ghost" onClick={handleSave}>Save</button>
                    <button type="button" className="copilot__btn copilot__btn--accent" onClick={handleUseSkill}>Use in chat</button>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
