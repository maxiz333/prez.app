/* ============================================================================
   RATTAZZI — Sincronizzazione Firebase (squadra unica, nessun codice)
   ---------------------------------------------------------------------------
   - ID squadra fisso: tutti i dispositivi del negozio condividono lo stesso
   - Autenticazione anonima automatica
   - Al primo avvio:
       * Se cloud vuoto → push dei dati locali
       * Se cloud ha dati più recenti → chiede conferma "vuoi sincronizzare?"
   - Backup automatico pre-sync: prima di scaricare, salva lo stato locale
   - Sync automatica dopo ogni salvataggio (debounce 2 sec)
   - Coda offline gestita da Firestore
   ========================================================================== */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAzJAJdBCiKNF1YFetZEDq3V6RdKf--gXY",
  authDomain: "prez-app-3fe9f.firebaseapp.com",
  projectId: "prez-app-3fe9f",
  storageBucket: "prez-app-3fe9f.firebasestorage.app",
  messagingSenderId: "136522066813",
  appId: "1:136522066813:web:73e70b9e8af8acf01c3a14"
};

// ⚠️ ID squadra FISSO: NON cambiarlo, tutti i dispositivi del negozio usano questo
const SQUADRA_ID = 'rattazzi-ufficiale';

const fb = {
  ready:false, app:null, db:null, auth:null, uid:null,
  pushTimer:null, pendingPush:false,
  suppressNextPush:false, firstPullDone:false
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

/* ============================================================================
   PRIMO SYNC — logica intelligente anti-perdita dati
   ========================================================================== */
async function cloudFirstSync(){
  if(fb.firstPullDone) return;
  fb.firstPullDone = true;

  cloudStatusSet('🟡 Controllo cloud...','warn');

  try{
    const ref = fb.db.collection('squadre').doc(SQUADRA_ID);
    const snap = await ref.get();

    // ---- CASO 1: cloud vuoto → push dei dati locali ----
    if(!snap.exists){
      console.log('☁️ Cloud vuoto: carico i dati locali');
      if(state){
        await cloudPush(true);
      } else {
        cloudStatusSet('🟢 Pronto','ok');
      }
      return;
    }

    // ---- CASO 2: cloud ha dati ----
    const remote = snap.data();
    if(!remote || !remote.payload){
      console.log('☁️ Cloud esiste ma è vuoto: carico i dati locali');
      if(state) await cloudPush(true);
      return;
    }

    const remoteTime = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
    const localTime  = (state && state.meta && state.meta.lastRevision)
      ? new Date(state.meta.lastRevision).getTime() : 0;

    // Conta articoli per il messaggio
    let remoteCount = 0, localCount = 0;
    try{
      const rp = JSON.parse(remote.payload);
      rp.categories.forEach(c => remoteCount += (c.articles||[]).length);
    }catch(e){}
    try{
      state.categories.forEach(c => localCount += (c.articles||[]).length);
    }catch(e){}

    // Se non ho dati locali significativi → pull diretto
    if(localCount === 0){
      console.log('☁️ Nessun dato locale → pull automatico');
      await cloudPullInternal(remote);
      cloudStatusSet('🟢 Sincronizzato','ok');
      return;
    }

    // Se remoto è più recente di almeno 10 secondi → chiedi conferma
    const diffSec = (remoteTime - localTime) / 1000;
    if(diffSec > 10){
      const msg = '☁️ Sincronizzazione cloud\n\n' +
        'Sul cloud ci sono dati PIÙ RECENTI di quelli di questo dispositivo.\n\n' +
        '  • Cloud: ' + remoteCount + ' articoli\n' +
        '  • Locale: ' + localCount + ' articoli\n\n' +
        'Vuoi scaricare i dati dal cloud?\n\n' +
        'OK = scarica dal cloud (i tuoi dati locali vanno in backup)\n' +
        'Annulla = tieni i tuoi dati locali e caricali sul cloud';
      if(confirm(msg)){
        await cloudPullInternal(remote);
        cloudStatusSet('🟢 Sincronizzato','ok');
      } else {
        console.log('☁️ Utente ha scelto locale → push');
        await cloudPush(true);
      }
      return;
    }

    // Se locale è più recente → push silenzioso
    if(localTime > remoteTime){
      console.log('☁️ Locale più recente → push');
      await cloudPush(true);
      return;
    }

    // Se sono sincronizzati → niente da fare
    console.log('☁️ Già sincronizzato');
    cloudStatusSet('🟢 Salvato','ok');

  }catch(e){
    console.error('First sync fallito:', e);
    cloudStatusSet('🔴 Offline','err');
  }
}

/* Pull interno (senza conferma — la conferma è già stata data) */
async function cloudPullInternal(remote){
  try{
    // Backup automatico dello stato attuale prima di sovrascrivere
    try{
      const localBackup = localStorage.getItem(STORAGE_KEY);
      if(localBackup){
        const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
        localStorage.setItem('rattazzi_pre_cloud_pull', localBackup);
        localStorage.setItem('rattazzi_pre_cloud_pull_date', stamp);
        console.log('💾 Backup pre-sync salvato ('+stamp+')');
      }
    }catch(e){}

    fb.suppressNextPush = true;
    state = normalizeState(JSON.parse(remote.payload));
    saveState(true);
    render();
    setTimeout(()=>{ fb.suppressNextPush = false; }, 1000);

    console.log('☁️ Pull OK');
    cloudStatusSet('🟢 Caricato da cloud','ok');
    return true;
  }catch(e){
    console.error('Pull fallito:', e);
    return false;
  }
}

/* Push su Firebase */
async function cloudPush(force){
  if(!fb.ready){ fb.pendingPush = true; return false; }
  if(!state) return false;

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

/* Pull manuale (dal click sull'indicatore stato o dal pulsante Impostazioni) */
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
    if(ok) alert('✅ Dati scaricati dal cloud.\n\nSe hai problemi, il backup pre-sync è in Impostazioni.');
    return ok;
  }catch(e){
    console.error('Pull manuale fallito:', e);
    alert('❌ Errore: '+e.message);
    return false;
  }
}

/* Ripristina il backup pre-cloud-pull */
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

/* Collega i pulsanti */
document.addEventListener('DOMContentLoaded', ()=>{
  // Click sull'indicatore stato → pull manuale
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
  // Pulsante "Sincronizza ora" nelle Impostazioni
  const btnSync = document.getElementById('btnCloudSync');
  if(btnSync){
    btnSync.addEventListener('click', async ()=>{
      if(!fb.ready){ alert('Firebase non pronto.'); return; }
      await cloudPush(true);
      alert('✅ Sincronizzato con il cloud.');
    });
  }
  // Pulsante "Ripristina backup pre-sync"
  const btnRestore = document.getElementById('btnRestorePrePull');
  if(btnRestore){
    btnRestore.addEventListener('click', cloudRestorePrePullBackup);
  }
});

window.cloudInit = cloudInit;
window.cloudPush = cloudPush;
window.cloudPull = cloudPull;
window.cloudRestorePrePullBackup = cloudRestorePrePullBackup;