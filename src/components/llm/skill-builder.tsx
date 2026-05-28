import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
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
  type LLMSkill,
} from '@/lib/llm/skills';

interface SkillBuilderProps {
  open: boolean;
  onClose: () => void;
  activeSkillId: string | null;
  onActiveSkillChange: (skillId: string | null) => void;
}

export function SkillBuilder({ open, onClose, activeSkillId, onActiveSkillChange }: SkillBuilderProps) {
  const [skills, setSkills] = useState<LLMSkill[]>(() => loadSkills());
  const [selectedId, setSelectedId] = useState<string | null>(activeSkillId);
  const [draft, setDraft] = useState<LLMSkill | null>(null);
  const [saveError, setSaveError] = useState('');

  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.id === selectedId) ?? null,
    [selectedId, skills],
  );

  const syncDraft = useCallback((skill: LLMSkill | null) => {
    setDraft(skill ? { ...skill } : null);
    setSaveError('');
  }, []);

  useEffect(() => {
    if (!open) return;
    const latest = loadSkills();
    setSkills(latest);
    const initial = latest.find((skill) => skill.id === activeSkillId) ?? latest[0] ?? null;
    setSelectedId(initial?.id ?? null);
    syncDraft(initial);
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
  }, [syncDraft]);

  const handleCreateBlank = useCallback(() => {
    const skill = createBlankSkill();
    const next = [...skills, skill];
    persistSkills(next);
    setSelectedId(skill.id);
    syncDraft(skill);
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
      // fallback: no clipboard
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
              <button type="button" className="copilot__skills-action" onClick={handleCreateBlank}>New skill</button>
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
                <div className="copilot__skills-list-empty">No skills yet. Start from a template or create a blank skill.</div>
              )}
              {skills.map((skill) => (
                <button
                  key={skill.id}
                  type="button"
                  className={`copilot__skills-list-item${selectedId === skill.id ? ' copilot__skills-list-item--active' : ''}${activeSkillId === skill.id ? ' copilot__skills-list-item--in-use' : ''}`}
                  onClick={() => handleSelect(skill)}
                >
                  <span className="copilot__skills-list-name">{skill.name}</span>
                  <span className="copilot__skills-list-desc">{skill.description}</span>
                  {activeSkillId === skill.id && <span className="copilot__skills-list-badge">Active</span>}
                </button>
              ))}
            </div>

            <div className="copilot__skills-list-footer">
              <button type="button" className="copilot__skills-link" onClick={handleImport}>Import SKILL.md</button>
            </div>
          </aside>

          <section className="copilot__skills-editor">
            {!draft ? (
              <div className="copilot__skills-editor-empty">Select or create a skill to edit.</div>
            ) : (
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
