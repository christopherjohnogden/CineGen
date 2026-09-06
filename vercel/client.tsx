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
  return <main className="vg-login"><form onSubmit={login}><div className="vg-brand">CineGen</div><h1>Your studio, anywhere.</h1><p>Sign in with your CineGen Cloud account to open your projects and saved work.</p>{loading?<p>Connecting…</p>:<><label>Email<input name="email" type="email" autoComplete="username" required/></label><label>Password<input name="password" type="password" autoComplete="current-password" required/></label><button disabled={busy}>{busy?'Signing in…':'Open CineGen'}</button>{cloudAuth.currentUser&&<button type="button" className="vg-secondary" onClick={()=>void signOut(cloudAuth)}>Use another account</button>}</>}{error&&<p role="alert">{error}</p>}<small>Use the same cloud account as CineGen Desktop. Your ChatGPT sign-in may be different.</small></form></main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><App/></ErrorBoundary></StrictMode>);
