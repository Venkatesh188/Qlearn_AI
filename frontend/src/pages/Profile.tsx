import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, UserRound } from 'lucide-react';
import { getProfile, saveProfile, type Profile as ProfileT } from '../services/api';
import { PrefsPicker, DEFAULT_PREFS } from '../components/Prefs';

const inputCls =
  'w-full px-4 py-3 rounded-xl bg-surface border border-border-subtle text-text-main placeholder-text-faint outline-none focus:border-primary focus:shadow-glow transition';

const Profile: React.FC = () => {
  const navigate = useNavigate();
  const [p, setP] = useState<ProfileT>(() => getProfile() ?? { name: '', background: '', ...DEFAULT_PREFS });
  const [saved, setSaved] = useState(false);

  const onSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveProfile({ ...p, name: p.name.trim(), background: p.background.trim() });
    setSaved(true);
    setTimeout(() => navigate('/'), 600);
  };

  return (
    <div className="max-w-xl mx-auto px-4 pt-12 pb-24">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-12 h-12 rounded-2xl bg-primary-light flex items-center justify-center">
          <UserRound size={24} className="text-primary" />
        </div>
        <div>
          <h1 className="font-display font-bold text-text-main text-2xl">Your profile</h1>
          <p className="text-sm text-text-muted">Used to tailor every course you generate. Stored only in this browser.</p>
        </div>
      </div>

      <form onSubmit={onSave} className="bg-surface border border-border-subtle rounded-2xl shadow-card p-6 space-y-6">
        <div>
          <label htmlFor="name" className="block text-xs font-bold uppercase tracking-wider text-text-faint mb-2.5">Name</label>
          <input id="name" className={inputCls} value={p.name} onChange={e => setP({ ...p, name: e.target.value })} placeholder="Ada" />
        </div>
        <div>
          <label htmlFor="bg" className="block text-xs font-bold uppercase tracking-wider text-text-faint mb-2.5">Role / background</label>
          <textarea
            id="bg"
            rows={3}
            className={`${inputCls} resize-none`}
            value={p.background}
            onChange={e => setP({ ...p, background: e.target.value })}
            placeholder="e.g. Backend engineer new to ML"
          />
        </div>
        <div className="pt-2 border-t border-border-subtle">
          <p className="text-sm font-semibold text-text-main mt-4 mb-4">Default preferences</p>
          <PrefsPicker level={p.level} depth={p.depth} style={p.style} onChange={prefs => setP({ ...p, ...prefs })} />
        </div>
        <button
          type="submit"
          className="w-full py-3.5 rounded-2xl bg-primary hover:bg-primary-hover text-white font-bold text-sm transition-colors shadow-card flex items-center justify-center gap-2"
        >
          {saved && <Check size={18} />}
          {saved ? 'Saved' : 'Save profile'}
        </button>
      </form>
    </div>
  );
};

export default Profile;
