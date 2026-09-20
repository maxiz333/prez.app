/* ============================================================================
   RATTAZZI — Sincronizzazione Firebase
   ---------------------------------------------------------------------------
   Logica: all'avvio si carica SEMPRE la versione dal cloud.
   Il localStorage è solo cache di sicurezza per l'uso offline.
   Se il locale è più recente del cloud di >10 sec → chiedi (hai lavorato offline).
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
  suppressUntil:0, firstPullDone:false
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
      await cloudFirstSync();
    });

  }catch(e){
    console.error('Init Firebase fallita:', e);
    cloudStatusSet('🔴 Errore Firebase','err');
  }
}

/* Primo sync: SEMPRE dal cloud (con protezione se locale più recente) */
async function cloudFirstSync(){
  if(fb.firstPullDone) return;
  fb.firstPullDone = true;
  cloudStatusSet('🟡 Sincronizzo...','warn');
  try{
    const ref = fb.db.collection('squadre').doc(SQUADRA_ID);
    const snap = await ref.get();

    // Cloud vuoto → primo setup, carico i locali
    if(!snap.exists){
      console.log('☁️ Cloud vuoto: carico i dati locali');
      if(state) await cloudPush(true);
      else cloudStatusSet('🟢 Pronto','ok');
      return;
    }

    const remote = snap.data();
    if(!remote || !remote.payload){
      console.log('☁️ Cloud vuoto: carico i dati locali');
      if(state) await cloudPush(true);
      return;
    }

    const remoteTime = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
    const localTime = (state && state.meta && state.meta.lastRevision)
      ? new Date(state.meta.lastRevision).getTime() : 0;

    // Se il locale è significativamente più recente (>10 sec) → chiedi
    if(localTime > remoteTime + 10000){
      const msg = '⚠️ Sincronizzazione cloud\n\n' +
        'I tuoi dati LOCALI sono più recenti di quelli del cloud.\n\n' +
        'Sembra che tu abbia lavorato offline o su un altro dispositivo.\n\n' +
        '  • Locale: ' + new Date(localTime).toLocaleString('it-IT') + '\n' +
        '  • Cloud:  ' + new Date(remoteTime).toLocaleString('it-IT') + '\n\n' +
        'OK = CARICA i tuoi dati locali sul cloud (sovrascrive il cloud)\n' +
        'Annulla = SCARICA i dati dal cloud (perdi le modifiche locali)';
      if(confirm(msg)){
        await cloudPush(true);
      } else {
        await cloudPullInternal(remote);
      }
      return;
    }

    // Altrimenti: pull diretto dal cloud (comportamento principale)
    console.log('☁️ Carico dal cloud...');
    await cloudPullInternal(remote);
    cloudStatusSet('🟢 Caricato da cloud','ok');
  }catch(e){
    console.error('First sync fallito:', e);
    cloudStatusSet('🔴 Offline — uso locale','err');
  }
}

async function cloudPullInternal(remote){
  try{
    // Backup pre-sync
    try{
      const localBackup = localStorage.getItem(STORAGE_KEY);
      if(localBackup){
        const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
        localStorage.setItem('rattazzi_pre_cloud_pull', localBackup);
        localStorage.setItem('rattazzi_pre_cloud_pull_date', stamp);
        console.log('💾 Backup pre-sync salvato ('+stamp+')');
      }
    }catch(e){}

    // Sopprimi push per 3 secondi
    fb.suppressUntil = Date.now() + 3000;
    clearTimeout(fb.pushTimer);

    state = normalizeState(JSON.parse(remote.payload));
    saveState(true);
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

async function cloudPull(){
  if(!fb.ready){ alert('Firebase non pronto. Riprova tra qualche secondo.'); return false; }
  try{
    const ref = fb.db.collection('squadre').doc(SQUADRA_ID);
    const snap = await ref.get();
    if(!snap.exists){
      alert('☁️ Il cloud è vuoto. Non c\'è niente da scaricare.');
      return false;
    }
    const remote = snap.data();
    const ok = await cloudPullInternal(remote);
    if(ok){
      cloudStatusSet('🟢 Caricato da cloud','ok');
      alert('✅ Dati scaricati dal cloud.');
    }
    return ok;
  }catch(e){
    console.error('Pull manuale fallito:', e);
    alert('❌ Errore: '+e.message);
    return false;
  }
}

function cloudRestorePrePullBackup(){
  const backup = localStorage.getItem('rattazzi_pre_cloud_pull');
  if(!backup){
    alert('Nessun backup pre-sync disponibile.');
    return false;
  }
  const dateStr = localStorage.getItem('rattazzi_pre_cloud_pull_date') || 'sconosciuta';
  if(!confirm('Ripristinare il backup del '+dateStr+'?\n\nSovrascriverà i dati attuali.')){
    return false;
  }
  try{
    state = normalizeState(JSON.parse(backup));
    saveState(true);
    render();
    alert('✅ Backup ripristinato.');
    return true;
  }catch(e){
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
      if(confirm('☁️ Scaricare i dati dal cloud?\n\nI dati attuali verranno salvati come backup.')){
        await cloudPull();
      }
    });
  }
  // Pulsante "Carica dal cloud ora"
  const btnSync = document.getElementById('btnCloudSync');
  if(btnSync){
    btnSync.addEventListener('click', async ()=>{
      if(!fb.ready){ alert('Firebase non pronto.'); return; }
      if(confirm('☁️ Scaricare i dati dal cloud?\n\nI dati locali andranno in backup.')){
        await cloudPull();
      }
    });
  }
  // Pulsante "Forza invio al cloud"
  const btnPush = document.getElementById('btnCloudPush');
  if(btnPush){
    btnPush.addEventListener('click', async ()=>{
      if(!fb.ready){ alert('Firebase non pronto.'); return; }
      if(confirm('⬆ Inviare i dati locali al cloud?\n\nIl cloud verrà sovrascritto.')){
        await cloudPush(true);
        alert('✅ Dati inviati al cloud.');
      }
    });
  }
  // Pulsante ripristino backup pre-sync
  const btnRestore = document.getElementById('btnRestorePrePull');
  if(btnRestore){
    btnRestore.addEventListener('click', cloudRestorePrePullBackup);
  }
});

window.cloudInit = cloudInit;
window.cloudPush = cloudPush;
window.cloudPull = cloudPull;
window.cloudRestorePrePullBackup = cloudRestorePrePullBackup;