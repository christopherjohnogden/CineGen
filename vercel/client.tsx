import '../web/src/platform/install';
import { StrictMode, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { onIdTokenChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { cloudAuth } from '../src/lib/cloud/firebase';
import { ErrorBoundary } from '../src/components/error-boundary';
import { WebApp } from '../web/src/WebApp';
import './login.css';
function App(){
  const [ready,setReady]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{
    let active=true,sequence=0;
    const sync=async()=>{
      const attempt=++sequence;const user=cloudAuth.currentUser;
      if(!user){await fetch('/api/session',{method:'DELETE'});if(active&&attempt===sequence){setReady(false);setLoading(false);}return;}
      try {
        const idToken=await user.getIdToken();const r=await fetch('/api/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken})});
        if(!r.ok)throw new Error('This account could not connect to CineGen. Use your approved CineGen Cloud account.');
        if(active&&attempt===sequence){setReady(true);setError('');}
      }catch(e){if(active&&attempt===sequence){setError(e instanceof Error?e.message:'Connection failed.');setReady(false);}}
      finally{if(active&&attempt===sequence)setLoading(false);}
    };
    const stop=onIdTokenChanged(cloudAuth,()=>{void sync();});
    const timer=setInterval(()=>{void sync();},10*60*1000);
    return()=>{active=false;stop();clearInterval(timer);};
  },[]);
  async function login(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');const data=new FormData(event.currentTarget);try{await signInWithEmailAndPassword(cloudAuth,String(data.get('email')),String(data.get('password')));}catch{setError('Check your CineGen Cloud email and password.');}finally{setBusy(false);}}
  if(ready)return <WebApp/>;
  return (
    <main className="vg-login">
      <section className="vg-login__panel" aria-labelledby="signin-title">
        <div className="vg-brand">
          <img src="/cinegen-icon.png" width="64" height="64" alt="" />
          <span>CINEGEN</span>
        </div>
        <p className="vg-login__eyebrow">AI Film Production Studio</p>
        <h1 id="signin-title">Welcome back.</h1>
        <p className="vg-login__intro">Sign in to your CineGen Cloud account.<br />Your projects and saved work are waiting.</p>
        <form onSubmit={login} aria-busy={busy || loading}>
          {loading ? <p className="vg-login__loading" role="status">Connecting to your studio…</p> : <>
            <label htmlFor="signin-email">Email</label>
            <input id="signin-email" name="email" type="email" autoComplete="username" placeholder="you@example.com" required />
            <label htmlFor="signin-password">Password</label>
            <input id="signin-password" name="password" type="password" autoComplete="current-password" required />
            {error && <p className="vg-login__error" role="alert">{error}</p>}
            <button className="vg-login__submit" disabled={busy}>
              <span>{busy ? 'Signing in…' : 'Open CineGen'}</span>
              <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
            </button>
            {cloudAuth.currentUser && <button type="button" className="vg-secondary" onClick={() => void signOut(cloudAuth)}>Use another account</button>}
          </>}
        </form>
        <footer className="vg-login__footer">One studio. Every device.</footer>
      </section>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><App/></ErrorBoundary></StrictMode>);
