import React, { ChangeEvent, useRef, useState } from 'react';
import { Camera, Check, Eye, EyeOff, KeyRound, LoaderCircle, Mail, ShieldCheck, UserRound, X } from 'lucide-react';
import { AuthenticatedSession } from '../types/auth';
import { changeAccountPassword, updateAccountProfile } from '../services/auth';

interface AccountProfileProps {
  session: AuthenticatedSession;
  onSessionUpdated: (session: AuthenticatedSession) => void;
}

function resizeProfileImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      reject(new Error('Choose a JPEG, PNG, or WebP image.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read this image.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('This image could not be opened.'));
      image.onload = () => {
        const side = Math.min(image.naturalWidth, image.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('Image processing is not available in this browser.'));
          return;
        }
        context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

const roleLabel: Record<AuthenticatedSession['role'], string> = {
  college_admin: 'College administrator',
  trainer: 'Trainer',
  student: 'Student',
};

export const AccountProfile: React.FC<AccountProfileProps> = ({ session, onSessionUpdated }) => {
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(session.user.name);
  const [avatar, setAvatar] = useState<string | null>(session.user.avatar || null);
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [imageError, setImageError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);

  const handleImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImageError('');
    try {
      const resized = await resizeProfileImage(file);
      if (resized.length > 330_000) throw new Error('This image is too detailed to upload. Choose another image.');
      setAvatar(resized);
      setAvatarChanged(true);
      setProfileMessage('');
    } catch (error) {
      setImageError(error instanceof Error ? error.message : 'Could not prepare this image.');
    }
  };

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setProfileSaving(true);
    setProfileError('');
    setProfileMessage('');
    try {
      const result = await updateAccountProfile({ name, ...(avatarChanged ? { avatar } : {}) });
      onSessionUpdated({ ...session, user: result.user });
      setName(result.user.name);
      setAvatar(result.user.avatar || null);
      setAvatarChanged(false);
      setProfileMessage('Your profile has been saved.');
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Could not save your profile.');
    } finally {
      setProfileSaving(false);
    }
  };

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordError('');
    setPasswordMessage('');
    if (newPassword.length < 12) {
      setPasswordError('Use at least 12 characters for your new password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('The new passwords do not match.');
      return;
    }
    setPasswordSaving(true);
    try {
      await changeAccountPassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage('Password changed. Other signed-in sessions have been signed out.');
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : 'Could not change your password.');
    } finally {
      setPasswordSaving(false);
    }
  };

  const initials = session.user.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-indigo-950';

  return (
    <div className="mx-auto max-w-4xl space-y-6 animate-fadeIn">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">Account settings</p>
        <h1 className="mt-1 text-2xl font-extrabold text-slate-900 dark:text-white">Your profile</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Manage your account details, profile picture, and password.</p>
      </div>

      <form onSubmit={saveProfile} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h2 className="font-bold text-slate-900 dark:text-white">Personal details</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Your email address is used to sign in and cannot be changed here.</p>
        </div>
        <div className="space-y-5 p-5 sm:p-6">
          <div className="flex items-center gap-4">
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full border border-slate-200 bg-indigo-50 dark:border-slate-700 dark:bg-indigo-950">
              {avatar ? <img src={avatar} alt="Profile" className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center text-xl font-bold text-indigo-700 dark:text-indigo-300">{initials || <UserRound />}</span>}
            </div>
            <div>
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageChange} className="hidden" />
              <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                <Camera className="h-4 w-4" /> {avatar ? 'Change picture' : 'Add picture'}
              </button>
              {avatar && <button type="button" onClick={() => { setAvatar(null); setAvatarChanged(true); setProfileMessage(''); }} className="ml-2 inline-flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-medium text-slate-500 hover:text-rose-600"><X className="h-3.5 w-3.5" /> Remove</button>}
              <p className="mt-2 text-[11px] text-slate-500">Square crop · JPEG, PNG, or WebP · max 250 KB</p>
              {imageError && <p className="mt-1 text-xs text-rose-600">{imageError}</p>}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
              Full name
              <span className="relative block"><UserRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className={`${inputClass} pl-9`} value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={100} required autoComplete="name" /></span>
            </label>
            <label className="block space-y-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
              Email address
              <span className="relative block"><Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className={`${inputClass} cursor-not-allowed bg-slate-50 pl-9 dark:bg-slate-800`} value={session.user.email} readOnly aria-describedby="email-help" /></span>
              <span id="email-help" className="block text-[11px] font-normal text-slate-400">Contact your workspace administrator if this needs updating.</span>
            </label>
            <div className="space-y-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
              Account role
              <div className={`${inputClass} flex items-center gap-2 bg-slate-50 dark:bg-slate-800`}><ShieldCheck className="h-4 w-4 text-indigo-500" />{roleLabel[session.role]}</div>
            </div>
            <div className="space-y-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
              Workspace
              <div className={`${inputClass} truncate bg-slate-50 dark:bg-slate-800`}>{session.workspace.name}</div>
            </div>
          </div>
          {profileError && <p role="alert" className="text-sm text-rose-600">{profileError}</p>}
          {profileMessage && <p role="status" className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400"><Check className="h-4 w-4" />{profileMessage}</p>}
          <div className="flex justify-end border-t border-slate-100 pt-4 dark:border-slate-800">
            <button type="submit" disabled={profileSaving} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60">
              {profileSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{profileSaving ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </div>
      </form>

      <form onSubmit={savePassword} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h2 className="font-bold text-slate-900 dark:text-white">Change password</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Choose a new password with at least 12 characters.</p>
        </div>
        <div className="space-y-4 p-5 sm:p-6">
          <label className="block max-w-xl space-y-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
            Current password
            <span className="relative block"><KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className={`${inputClass} pl-9 pr-10`} type={showPasswords ? 'text' : 'password'} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required autoComplete="current-password" /></span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
              New password
              <input className={inputClass} type={showPasswords ? 'text' : 'password'} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={12} maxLength={256} required autoComplete="new-password" />
            </label>
            <label className="block space-y-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
              Confirm new password
              <input className={inputClass} type={showPasswords ? 'text' : 'password'} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={12} maxLength={256} required autoComplete="new-password" />
            </label>
          </div>
          <button type="button" onClick={() => setShowPasswords((value) => !value)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-indigo-600" aria-label={showPasswords ? 'Hide passwords' : 'Show passwords'}>
            {showPasswords ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}{showPasswords ? 'Hide passwords' : 'Show passwords'}
          </button>
          {passwordError && <p role="alert" className="text-sm text-rose-600">{passwordError}</p>}
          {passwordMessage && <p role="status" className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400"><Check className="h-4 w-4" />{passwordMessage}</p>}
          <div className="flex justify-end border-t border-slate-100 pt-4 dark:border-slate-800">
            <button type="submit" disabled={passwordSaving} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
              {passwordSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}{passwordSaving ? 'Updating…' : 'Update password'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
