/* ============================================================================
   RATTAZZI — Sincronizzazione Firebase (CLOUD-ONLY)
   ---------------------------------------------------------------------------
   - All'avvio: pull SEMPRE dal cloud (nessuna scelta utente)
   - Se cloud risponde → popola state e chiama window.__cloudReady()
   - Se cloud non risponde entro 8 sec → fallback silenzioso su cache locale
   - Se cloud è vuoto → push dal locale (o seed) come primo setup
   - Salvataggio: SEMPRE su cloud + cache locale silenziosa
   ========================================================================== */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAzJAJdBCiKNF1YFetZEDq3V6RdKf--gXY",
  authDomain: "prez-app-3fe9f.firebaseapp.com",
  projectId: "prez-app-3fe9f",
  storageBucket: "prez-app-3fe9f.firebasestorage.app",
  messagingSenderId: "136522066813",
  appId: "1:136522066813:web:73e70b9e8af8acf01c3a14"
};

const SQUADRA_ID = 'rattazzi-ufficiale';

const fb = {
  ready:false, app:null, db:null, auth:null, uid:null,
  pushTimer:null, pendingPush:false,
  suppressUntil:0, firstPullDone:false,
  fallbackTimer:null, fallbackDone:false
};

function cloudStatusSet(text, cls){
  const el = document.getElementById('cloudStatus');
  if(!el) return;
  el.textContent = text;
  el.className = 'cloud-status ' + (cls||'');
}

function triggerFallback(){
  if(fb.fallbackDone) return;
  fb.fallbackDone = true;
  console.warn('☁️ Timeout cloud: uso la cache locale');
  cloudStatusSet('🟡 Offline — uso cache locale','warn');
  try{
    if(window.__cloudFallbackLocal) window.__cloudFallbackLocal();
  }catch(e){console.error('Fallback fallito:',e);}
}

async function cloudInit(){
  if(typeof firebase === 'undefined'){
    console.warn('Firebase SDK non caricato');
    cloudStatusSet('🔴 Firebase assente','err');
    triggerFallback();
    return;
  }

  // Timeout di sicurezza: se entro 8 secondi Firebase non risponde, uso la cache locale
  clearTimeout(fb.fallbackTimer);
  fb.fallbackTimer = setTimeout(triggerFallback, 8000);

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
        triggerFallback();
        return;
      }
      fb.ready = true;
      console.log('☁️ Firebase pronto, uid:', fb.uid);
      await cloudFirstSync();
    });

  }catch(e){
    console.error('Init Firebase fallita:', e);
    cloudStatusSet('🔴 Errore Firebase','err');
    triggerFallback();
  }
}

/* Primo sync: SEMPRE dal cloud (nessuna scelta utente) */
async function cloudFirstSync(){
  if(fb.firstPullDone) return;
  fb.firstPullDone = true;
  cloudStatusSet('🟡 Sincronizzo...','warn');
  try{
    const ref = fb.db.collection('squadre').doc(SQUADRA_ID);
    const snap = await ref.get();

    // Timeout: cancello perché Firebase ha risposto
    clearTimeout(fb.fallbackTimer);
    fb.fallbackDone = true;

    // ---- CASO 1: cloud vuoto → primo setup ----
    if(!snap.exists){
      console.log('☁️ Cloud vuoto: primo setup, carico dati locali');
      // Provo a recuperare da cache locale
      let localToUpload = null;
      try{
        for(const k of [STORAGE_KEY,...BACKUP_KEYS,...LEGACY_KEYS]){
          const raw = localStorage.getItem(k);
          if(!raw) continue;
          try{
            const p = JSON.parse(raw);
            if(p && Array.isArray(p.categories) && p.categories.length){
              localToUpload = normalizeState(p);
              break;
            }
          }catch(e){}
        }
      }catch(e){}

      if(localToUpload){
        state = localToUpload;
        activeCategoryId = state.categories[0] ? state.categories[0].id : null;
        await cloudPush(true);
      } else {
        // Nessuna cache → carico seed demo
        state = buildSeed();
        activeCategoryId = state.categories[0] ? state.categories[0].id : null;
        await cloudPush(true);
      }
      cloudStatusSet('🟢 Pronto','ok');
      if(window.__cloudReady) window.__cloudReady();
      return;
    }

    // ---- CASO 2: cloud ha dati → pull SEMPRE ----
    const remote = snap.data();
    if(!remote || !remote.payload){
      console.log('☁️ Cloud vuoto (payload mancante): primo setup');
      // stesso discorso del caso 1
      state = buildSeed();
      activeCategoryId = state.categories[0] ? state.categories[0].id : null;
      await cloudPush(true);
      if(window.__cloudReady) window.__cloudReady();
      return;
    }

    console.log('☁️ Carico dal cloud...');
    await cloudPullInternal(remote);
    cloudStatusSet('🟢 Caricato da cloud','ok');
    if(window.__cloudReady) window.__cloudReady();

  }catch(e){
    console.error('First sync fallito:', e);
    cloudStatusSet('🔴 Offline — uso cache locale','err');
    triggerFallback();
  }
}

async function cloudPullInternal(remote){
  try{
    fb.suppressUntil = Date.now() + 3000;
    clearTimeout(fb.pushTimer);

    state = normalizeState(JSON.parse(remote.payload));
    // Salva in cache locale (silenzioso)
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }catch(e){}

    // Aggiorna UI
    if(state.categories.length && (!activeCategoryId || !state.categories.find(c=>c.id===activeCategoryId))){
      activeCategoryId = state.categories[0].id;
    }
    render();

    console.log('☁️ Pull OK');
    return true;
  }catch(e){
    console.error('Pull fallito:', e);
    return false;
  }
}

async function cloudPush(force){
  if(!fb.ready){ fb.pendingPush = true; return false; }
  if(!state) return false;

  if(fb.suppressUntil && Date.now() < fb.suppressUntil) return false;

  if(!force){
    fb.pendingPush = true;
    clearTimeout(fb.pushTimer);
    fb.pushTimer = setTimeout(()=>{
      if(fb.suppressUntil && Date.now() < fb.suppressUntil) return;
      cloudPush(true);
    }, 2000);
    cloudStatusSet('🟡 In attesa...','warn');
    return true;
  }

  cloudStatusSet('🟡 Salvo...','warn');
  try{
    const ref = fb.db.collection('squadre').doc(SQUADRA_ID);
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

/* Pull manuale (dal pulsante nelle Impostazioni) */
async function cloudPull(){
  if(!fb.ready){ alert('Firebase non pronto. Riprova tra qualche secondo.'); return false; }
  try{
    const ref = fb.db.collection('squadre').doc(SQUADRA_ID);
    const snap = await ref.get();
    if(!snap.exists){
      alert('☁️ Il cloud è vuoto.');
      return false;
    }
    const remote = snap.data();
    const ok = await cloudPullInternal(remote);
    if(ok){
      cloudStatusSet('🟢 Ricaricato','ok');
      alert('✅ Dati ricaricati dal cloud.');
    }
    return ok;
  }catch(e){
    console.error('Pull manuale fallito:', e);
    alert('❌ Errore: '+e.message);
    return false;
  }
}

window.addEventListener('online', ()=>{
  console.log('☁️ Torna online');
  cloudStatusSet('🟡 Riconnessione...','warn');
  setTimeout(()=>{
    if(fb.pendingPush) cloudPush(true);
  }, 1000);
});
window.addEventListener('offline', ()=>{
  cloudStatusSet('🔴 Offline','err');
});

document.addEventListener('DOMContentLoaded', ()=>{
  const status = document.getElementById('cloudStatus');
  if(status){
    status.addEventListener('click', async ()=>{
      if(!fb.ready){
        alert('☁️ Firebase non ancora pronto. Riprova tra qualche secondo.');
        return;
      }
      if(confirm('☁️ Ricaricare i dati dal cloud?')){
        await cloudPull();
      }
    });
  }
  const btnSync = document.getElementById('btnCloudSync');
  if(btnSync){
    btnSync.addEventListener('click', async ()=>{
      if(!fb.ready){ alert('Firebase non pronto.'); return; }
      if(confirm('☁️ Ricaricare i dati dal cloud?')){
        await cloudPull();
      }
    });
  }
});

window.cloudInit = cloudInit;
window.cloudPush = cloudPush;
window.cloudPull = cloudPull;