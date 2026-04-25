import { useEffect, useState } from 'react';
import { loadPrefs, savePrefs } from '../localPrefs.js';

/**
 * Modal shown before joining/creating a game when the user has no display name.
 * Captures the name once, persists it locally, then calls onConfirm(name).
 */
export default function NamePrompt({ open, onClose, onConfirm, title, ctaLabel }) {
  const [name, setName] = useState('');

  useEffect(() => {
    if (!open) return;
    const prefs = loadPrefs();
    setName(prefs.lastName || '');
  }, [open]);

  if (!open) return null;

  const submit = (e) => {
    e?.preventDefault?.();
    const trimmed = name.trim();
    if (trimmed.length < 1) return;
    if (trimmed.length > 20) return;
    savePrefs({ lastName: trimmed });
    onConfirm(trimmed);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title || "What's your name?"}</h3>
          <button className="btn small ghost" onClick={onClose}>✕</button>
        </div>
        <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
          Pick any name — your opponents will see this. We'll remember it for next time.
        </p>
        <form onSubmit={submit}>
          <label className="field">
            <span>Display name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              autoFocus
              placeholder="e.g. Alex"
              required
            />
          </label>
          <button className="btn primary" type="submit" style={{ width: '100%' }} disabled={name.trim().length < 1}>
            {ctaLabel || 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}