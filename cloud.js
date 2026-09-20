/* ============================================================================
   RATTAZZI — Sincronizzazione Firebase (multi-dispositivo + multi-utente)
   ---------------------------------------------------------------------------
   Tutti i dispositivi con lo stesso "codice squadra" condividono gli stessi dati.
   Ogni modifica viene spinta su Firebase dopo 2 secondi dall'ultima modifica.
   Se manca internet, Firestore mette in coda le modifiche e le invia appena torna.
   ========================================================================== */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAzJAJdBCiKNF1YFetZEDq3V6RdKf--gXY",
  authDomain: "prez-app-3fe9f.firebaseapp.com",
  projectId: "prez-app-3fe9f",
  storageBucket: "prez-app-3fe9f.firebasestorage.app",
  messagingSenderId: "136522066813",
  appId: "1:136522066813:web:73e70b9e8af8acf01c3a14"
};

const fb = {
  ready:false, app:null, db:null, auth:null, uid:null,
  squadraCode:null, pushTimer:null, pendingPush:false,
  suppressNextPush:false, status:'init'
};

function cloudStatusSet(text, cls){
  const el = document.getElementById('cloudStatus');
  if(!el) return;
  el.textContent = text;
  el.className = 'cloud-status ' + (cls||'');
}

async function cloudInit(){
  if(typeof firebase === 'undefined'){
    console.warn('Firebase SDK non caricato');
    cloudStatusSet('🔴 Firebase assente','err');
    return;
  }
  cloudStatusSet('⏳ Connessione...','warn');
  try{
    fb.app  = firebase.initializeApp(FIREBASE_CONFIG);
    fb.auth = firebase.auth();
    fb.db   = firebase.firestore();

    try{
      await fb.db.enablePersistence({synchronizeTabs:true});
      console.log('☁️ Persistenza offline attiva');
    }catch(e){
      console.warn('Persistenza offline non attiva:', e.code || e.message);
    }

    fb.auth.onAuthStateChanged(async user => {
      try{
        if(!user){
          const cred = await fb.auth.signInAnonymously();
          fb.uid = cred.user.uid;
        } else {
          fb.uid = user.uid;
        }
      }catch(e){
        console.error('Auth fallita:', e);
        cloudStatusSet('🔴 Auth fallita','err');
        return;
      }
      fb.ready = true;
      console.log('☁️ Firebase pronto, uid:', fb.uid);

      const saved = localStorage.getItem('rattazzi_squadra');
      if(saved){
        fb.squadraCode = saved;
        cloudStatusSet('🟡 Sync...','warn');
        await cloudPull(true);
      } else {
        cloudStatusSet('⚙ Configura squadra','warn');
      }
      const inp = document.getElementById('setSquadra');
      if(inp && fb.squadraCode) inp.value = fb.squadraCode;
    });

  }catch(e){
    console.error('Init Firebase fallita:', e);
    cloudStatusSet('🔴 Errore Firebase','err');
  }
}

async function cloudSetSquadra(code){
  code = (code||'').trim().toLowerCase().replace(/[^a-z0-9\-_]/g,'-');
  if(code.length < 3){
    alert('Codice squadra troppo corto. Minimo 3 caratteri.');
    return false;
  }
  fb.squadraCode = code;
  localStorage.setItem('rattazzi_squadra', code);
  cloudStatusSet('🟡 Sync...','warn');
  await cloudPull(true);
  return true;
}

async function cloudPull(silent){
  if(!fb.ready || !fb.squadraCode){
    if(!silent) alert('Firebase non pronto o codice squadra mancante.');
    return false;
  }
  cloudStatusSet('🟡 Leggo...','warn');
  try{
    const ref = fb.db.collection('squadre').doc(fb.squadraCode);
    const snap = await ref.get();

    if(!snap.exists){
      if(state){
        console.log('☁️ Nessun dato remoto, eseguo primo upload');
        await cloudPush(true);
        return true;
      }
      cloudStatusSet('☁️ Nessun dato remoto','warn');
      return false;
    }

    const remote = snap.data();
    if(!remote || !remote.payload){
      cloudStatusSet('⚠ Dato remoto vuoto','warn');
      return false;
    }

    const remoteTime = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
    const localTime  = (state && state.meta && state.meta.lastRevision)
      ? new Date(state.meta.lastRevision).getTime() : 0;

    if(remoteTime > localTime){
      try{
        const localBackup = localStorage.getItem(STORAGE_KEY);
        if(localBackup) localStorage.setItem('rattazzi_pre_cloud_pull', localBackup);
      }catch(e){}

      fb.suppressNextPush = true;
      state = normalizeState(JSON.parse(remote.payload));
      saveState(true);
      render();
      setTimeout(()=>{ fb.suppressNextPush = false; }, 500);
      cloudStatusSet('🟢 Caricato da cloud','ok');
      console.log('☁️ Pull OK (remoto più recente)');
      return true;
    } else if(localTime > remoteTime){
      console.log('☁️ Locale più recente → push');
      await cloudPush(true);
      return true;
    } else {
      cloudStatusSet('🟢 Sincronizzato','ok');
      return true;
    }
  }catch(e){
    console.error('Pull fallito:', e);
    cloudStatusSet('🔴 Offline','err');
    return false;
  }
}

async function cloudPush(force){
  if(!fb.ready || !fb.squadraCode){
    fb.pendingPush = true;
    return false;
  }
  if(!state) return false;

  // Blocco durante un pull per non creare loop
  if(fb.suppressNextPush){
    fb.suppressNextPush = false;
    return false;
  }

  if(!force){
    fb.pendingPush = true;
    clearTimeout(fb.pushTimer);
    fb.pushTimer = setTimeout(()=>cloudPush(true), 2000);
    cloudStatusSet('🟡 In attesa...','warn');
    return true;
  }

  cloudStatusSet('🟡 Salvo...','warn');
  try{
    const ref = fb.db.collection('squadre').doc(fb.squadraCode);
    const payload = JSON.stringify(state);
    await ref.set({
      payload,
      updatedAt: new Date().toISOString(),
      uid: fb.uid,
      appVersion: APP_VERSION
    });
    fb.pendingPush = false;
    cloudStatusSet('🟢 Salvato','ok');
    console.log('☁️ Push OK ('+Math.round(payload.length/1024)+' KB)');
    return true;
  }catch(e){
    console.error('Push fallito:', e);
    fb.pendingPush = true;
    cloudStatusSet('🔴 Offline','err');
    return false;
  }
}

window.addEventListener('online', ()=>{
  console.log('☁️ Torna online');
  cloudStatusSet('🟡 Riconnessione...','warn');
  setTimeout(()=>{
    if(fb.pendingPush) cloudPush(true);
    else cloudPull(true);
  }, 1000);
});
window.addEventListener('offline', ()=>{
  cloudStatusSet('🔴 Offline','err');
});

document.addEventListener('DOMContentLoaded', ()=>{
  const b1 = document.getElementById('btnCloudSync');
  if(b1) b1.addEventListener('click', async ()=>{
    if(!fb.squadraCode){
      const code = prompt('Inserisci il codice squadra (uguale su tutti i dispositivi):');
      if(code){ await cloudSetSquadra(code); }
      return;
    }
    await cloudPush(true);
    alert('✅ Sincronizzato.');
  });

  const b2 = document.getElementById('btnCloudPull');
  if(b2) b2.addEventListener('click', async ()=>{
    if(!fb.squadraCode){
      const code = prompt('Inserisci il codice squadra:');
      if(!code) return;
      if(!(await cloudSetSquadra(code))) return;
    }
    if(confirm('Sovrascrivere i dati locali con quelli del cloud?')){
      await cloudPull(false);
      alert('✅ Dati caricati dal cloud.');
    }
  });

  const b3 = document.getElementById('btnSetSquadra');
  if(b3) b3.addEventListener('click', async ()=>{
    const inp = document.getElementById('setSquadra');
    const code = inp ? inp.value : '';
    if(await cloudSetSquadra(code)){
      alert('✅ Codice squadra impostato: '+fb.squadraCode+
            '\n\nOra questo dispositivo sincronizza con la squadra.');
    }
  });
});

window.cloudInit = cloudInit;
window.cloudPush = cloudPush;
window.cloudPull = cloudPull;
window.cloudSetSquadra = cloudSetSquadra;