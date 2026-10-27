import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';

export default function CustomLogin() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { checkUserAuth } = useAuth();

  const submit = async (event) => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      if (mode === 'register') await base44.auth.register(email, password, displayName);
      else await base44.auth.loginViaEmailPassword(email, password);
      await checkUserAuth();
      const next = new URLSearchParams(location.search).get('next') || '/';
      navigate(next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true });
    } catch (err) {
      setError(err?.message || 'Unable to sign in. Please try again.');
    } finally { setBusy(false); }
  };

  return <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-blue-950 to-indigo-950 px-4 py-12">
    <section className="w-full max-w-md rounded-2xl border border-white/10 bg-white p-8 shadow-2xl">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-950 text-white"><ShieldCheck size={30}/></div>
      <h1 className="text-center text-2xl font-bold text-slate-900">SafeNestT</h1>
      <p className="mt-2 text-center text-sm text-slate-600">Secure access to your investigation workspace</p>
      <div className="mt-7 grid grid-cols-2 rounded-lg bg-slate-100 p-1">
        <button type="button" onClick={() => {setMode('login');setError('');}} className={`rounded-md py-2 text-sm font-medium ${mode==='login'?'bg-white text-slate-900 shadow':'text-slate-500'}`}>Sign in</button>
        <button type="button" onClick={() => {setMode('register');setError('');}} className={`rounded-md py-2 text-sm font-medium ${mode==='register'?'bg-white text-slate-900 shadow':'text-slate-500'}`}>Create account</button>
      </div>
      <form onSubmit={submit} className="mt-6 space-y-4">
        {mode==='register' && <label className="block text-sm font-medium text-slate-700">Full name<input required autoComplete="name" value={displayName} onChange={e=>setDisplayName(e.target.value)} maxLength={120} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"/></label>}
        <label className="block text-sm font-medium text-slate-700">Email address<input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} maxLength={254} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"/></label>
        <label className="block text-sm font-medium text-slate-700">Password<div className="relative mt-1"><input required type={showPassword?'text':'password'} autoComplete={mode==='register'?'new-password':'current-password'} minLength={mode==='register'?12:1} value={password} onChange={e=>setPassword(e.target.value)} maxLength={256} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pr-11 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"/><button type="button" aria-label={showPassword?'Hide password':'Show password'} onClick={()=>setShowPassword(v=>!v)} className="absolute right-3 top-3 text-slate-500">{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div>{mode==='register'&&<span className="mt-1 block text-xs text-slate-500">Use at least 12 characters.</span>}</label>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="w-full rounded-lg bg-blue-950 px-4 py-3 font-semibold text-white transition hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-60">{busy?'Please wait…':mode==='register'?'Create account':'Sign in'}</button>
      </form>
      <p className="mt-5 text-center text-xs leading-5 text-slate-500">Sessions are protected with secure cookies. New accounts receive investigator access; additional permissions require administrator approval.</p>
    </section>
  </main>;
}
