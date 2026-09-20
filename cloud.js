/* ============================================================================
   RATTAZZI — Cloud SOLO (v4.0)
   ---------------------------------------------------------------------------
   L'app carica SEMPRE e SOLO i dati dal cloud. Nessun confronto.
   Nessun popup di scelta. Il localStorage non viene mai letto all'avvio.
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
  console.warn('☁️ Timeout cloud');
  cloudStatusSet('🔴 Offline — ricarica la pagina','err');
  try{
    if(window.__cloudFallbackLocal) window.__cloudFallbackLocal();
  }catch(e){}
}

async function cloudInit(){
  if(typeof firebase === 'undefined'){
    console.warn('Firebase SDK non caricato');
    cloudStatusSet('🔴 Firebase assente','err');
    triggerFallback();
    return;
  }

  clearTimeout(fb.fallbackTimer);
  fb.fallbackTimer = setTimeout(triggerFallback, 10000);

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

/* Primo sync: SEMPRE e SOLO dal cloud. Nessun confronto. */
async function cloudFirstSync(){
  if(fb.firstPullDone) return;
  fb.firstPullDone = true;
  cloudStatusSet('🟡 Carico dal cloud...','warn');
  try{
    const ref = fb.db.collection('squadre').doc(SQUADRA_ID);
    const snap = await ref.get();

    clearTimeout(fb.fallbackTimer);
    fb.fallbackDone = true;

    // Cloud vuoto → primo setup, carico seed demo e faccio push
    if(!snap.exists){
      console.log('☁️ Cloud vuoto: primo setup con dati demo');
      state = buildSeed();
      const firstTop = state.categories.find(c=>!c.parentId);
      activeCategoryId = firstTop ? firstTop.id : null;
      activeSubCategoryId = null;
      await cloudPush(true);
      cloudStatusSet('🟢 Pronto','ok');
      if(window.__cloudReady) window.__cloudReady();
      return;
    }

    const remote = snap.data();
    if(!remote || !remote.payload){
      console.log('☁️ Cloud senza payload: primo setup con dati demo');
      state = buildSeed();
      const firstTop = state.categories.find(c=>!c.parentId);
      activeCategoryId = firstTop ? firstTop.id : null;
      activeSubCategoryId = null;
      await cloudPush(true);
      if(window.__cloudReady) window.__cloudReady();
      return;
    }

    // Cloud ha dati → pull SEMPRE. Punto.
    console.log('☁️ Carico dal cloud (fonte unica)');
    state = normalizeState(JSON.parse(remote.payload));
    const firstTop = state.categories.find(c=>!c.parentId);
    activeCategoryId = firstTop ? firstTop.id : null;
    activeSubCategoryId = null;

    // Salvo solo come cache tecnica (mai letta all'avvio)
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch(e){}

    render();
    updateInfoBar();
    cloudStatusSet('🟢 Caricato da cloud','ok');
    if(window.__cloudReady) window.__cloudReady();

  }catch(e){
    console.error('First sync fallito:', e);
    cloudStatusSet('🔴 Offline — ricarica la pagina','err');
    triggerFallback();
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
    }, 1500);
    cloudStatusSet('🟡 Salvo...','warn');
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
    cloudStatusSet('🟢 Salvato online','ok');
    console.log('☁️ Push OK ('+Math.round(payload.length/1024)+' KB)');
    return true;
  }catch(e){
    console.error('Push fallito:', e);
    fb.pendingPush = true;
    cloudStatusSet('🔴 Offline','err');
    return false;
  }
}

async function cloudPull(){
  if(!fb.ready){ alert('Firebase non pronto.'); return false; }
  try{
    const ref = fb.db.collection('squadre').doc(SQUADRA_ID);
    const snap = await ref.get();
    if(!snap.exists){ alert('☁️ Il cloud è vuoto.'); return false; }
    const remote = snap.data();
    state = normalizeState(JSON.parse(remote.payload));
    const firstTop = state.categories.find(c=>!c.parentId);
    activeCategoryId = firstTop ? firstTop.id : null;
    activeSubCategoryId = null;
    render();
    cloudStatusSet('🟢 Ricaricato','ok');
    return true;
  }catch(e){
    alert('❌ Errore: '+e.message);
    return false;
  }
}

window.addEventListener('online', ()=>{
  cloudStatusSet('🟡 Riconnessione...','warn');
  setTimeout(()=>{ if(fb.pendingPush) cloudPush(true); }, 800);
});
window.addEventListener('offline', ()=>{
  cloudStatusSet('🔴 Offline','err');
});

document.addEventListener('DOMContentLoaded', ()=>{
  const status = document.getElementById('cloudStatus');
  if(status){
    status.addEventListener('click', async ()=>{
      if(!fb.ready){ alert('Firebase non pronto.'); return; }
      if(confirm('☁️ Ricaricare i dati dal cloud?')){ await cloudPull(); }
    });
  }
  const btnSync = document.getElementById('btnCloudSync');
  if(btnSync){
    btnSync.addEventListener('click', async ()=>{
      if(!fb.ready){ alert('Firebase non pronto.'); return; }
      if(confirm('☁️ Ricaricare i dati dal cloud?')){ await cloudPull(); }
    });
  }
});

window.cloudInit = cloudInit;
window.cloudPush = cloudPush;
window.cloudPull = cloudPull;