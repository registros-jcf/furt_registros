// 0. Registrar Service Worker para PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js')
    .then(() => console.log('Motor offline encendido 🚀'))
    .catch(err => console.error('Falla en Service Worker:', err));
}

const DB_NAME = 'RegistroTerritorialDB';
const STORE_NAME = 'pendientes';
let db;

// 1. Inicializar IndexedDB
const request = indexedDB.open(DB_NAME, 1);
request.onupgradeneeded = e => {
  db = e.target.result;
  db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
};
request.onsuccess = e => { db = e.target.result; updatePendingCount(); };

// 2. Validaciones Globales de Inputs
document.addEventListener('input', e => {
  if (e.target.matches('input[type="text"], textarea')) {
    const original = e.target.value;
    let val = original;
    val = val.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); 
    val = val.replace(/[^a-zA-Z0-9\s]/g, ""); 
    val = val.toUpperCase();

    if (val !== original) {
      const start = e.target.selectionStart;
      const end = e.target.selectionEnd;
      const diff = val.length - original.length;
      e.target.value = val;
      if (typeof start === 'number' && e.target.setSelectionRange) {
        e.target.setSelectionRange(Math.max(0, start + diff), Math.max(0, end + diff));
      }
    }
  }
});

// 3. Compresión asíncrona de Imágenes a Base64
async function compressImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = event => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const MAX_WIDTH = 800;
        const scaleSize = MAX_WIDTH / img.width;
        canvas.width = MAX_WIDTH;
        canvas.height = img.height * scaleSize;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
    };
  });
}

// 4. Badges dinámicos para fotos
document.querySelectorAll('input[type="file"]').forEach(input => {
  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const badge = document.getElementById(`badge-${e.target.id}`);
    badge.textContent = '⏳ Comprimiendo...';
    badge.className = 'badge bg-warning text-dark mt-1';
    
    const base64 = await compressImage(file);
    e.target.dataset.base64 = base64; 
    
    badge.textContent = navigator.onLine ? '✅ Listo' : '💾 Offline';
    badge.className = 'badge bg-success mt-1';
  });
});

// 5. Envíos y Modo Offline
async function submitForm(formElement, formType) {
  const formData = new FormData(formElement);
  const btnSubmit = document.getElementById('btnSubmit');
  const loadingOverlay = document.getElementById('loadingOverlay');
  if (btnSubmit) { btnSubmit.disabled = true; }
  if (loadingOverlay) { loadingOverlay.classList.remove('d-none'); }

  const payload = { formType: formType, fields: {}, images: {} };
  for (let [key, value] of formData.entries()) {
    if (typeof value === 'string') payload.fields[key] = value;
  }
  
  payload.fields['Timestamp'] = new Date().toLocaleString('es-MX');

  formElement.querySelectorAll('input[type="file"]').forEach(input => {
    if (input.dataset.base64) payload.images[input.name] = input.dataset.base64;
  });

  try {
    const response = await fetch('https://script.google.com/macros/s/AKfycby7kqN1YCUbgjA_RJHpsMkQmo4IsTZeC2pXElzAkvwYGvaz2iUuNIQbT2_f7oCpkxCV/exec', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    
    const data = await response.json();
    
    if (data.status === 'error') {
        Swal.fire({ icon: 'error', title: 'Error del servidor', text: data.message, confirmButtonColor: '#b38e5d' });
        if (loadingOverlay) { loadingOverlay.classList.add('d-none'); }
        if (btnSubmit) { btnSubmit.disabled = false; }
        return; 
    }

    if (!response.ok) throw new Error('Network error');
    
    Swal.fire({ icon: 'success', title: '¡Éxito!', text: 'Registro guardado en Sheets y Drive.', confirmButtonColor: '#b38e5d' });
    formElement.reset();
    sessionStorage.removeItem('borrador_' + formElement.id); 
    
    if (loadingOverlay) { loadingOverlay.classList.add('d-none'); }
    if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = '💾 Guardar Registro'; }
  } catch (error) {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add(payload);
    tx.oncomplete = () => {
      updatePendingCount();
      Swal.fire({ icon: 'info', title: 'Modo Offline', text: 'Sin conexión. Registro guardado localmente 💾', confirmButtonColor: '#b38e5d' });
      formElement.reset();
      sessionStorage.removeItem('borrador_' + formElement.id); 
      if (loadingOverlay) { loadingOverlay.classList.add('d-none'); }
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = '💾 Guardar Registro'; }
    };
  }
}

// 6. Contador y Sincronizador
function updatePendingCount() {
  const tx = db.transaction(STORE_NAME, 'readonly');
  const req = tx.objectStore(STORE_NAME).count();
  req.onsuccess = () => {
    const count = req.result;
    document.getElementById('sync-counter').textContent = `Pendientes: ${count}`;
  };
}

// 7. Sincronizar manualmente los pendientes
async function syncPending() {
  if (!navigator.onLine) {
    Swal.fire({ icon: 'warning', title: 'Sin conexión', text: 'Necesitas internet para sincronizar.', confirmButtonColor: '#b38e5d' });
    return;
  }

  const tx = db.transaction(STORE_NAME, 'readonly');
  const req = tx.objectStore(STORE_NAME).getAll();

  req.onsuccess = async () => {
    const registros = req.result;
    if (registros.length === 0) {
      Swal.fire({ icon: 'success', title: 'Al día', text: 'No hay registros pendientes por enviar.', confirmButtonColor: '#b38e5d' });
      return;
    }

    Swal.fire({ 
        title: 'Sincronizando', 
        text: `Iniciando envío de ${registros.length} registro(s) pendiente(s)... Por favor, no cierres la app.`,
        icon: 'info',
        showConfirmButton: false,
        allowOutsideClick: false
    });

    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) { loadingOverlay.classList.remove('d-none'); }
    let enviados = 0;

    for (let record of registros) {
      try {
        const response = await fetch('https://script.google.com/macros/s/AKfycby7kqN1YCUbgjA_RJHpsMkQmo4IsTZeC2pXElzAkvwYGvaz2iUuNIQbT2_f7oCpkxCV/exec', {
          method: 'POST',
          body: JSON.stringify(record)
        });

        if (!response.ok) throw new Error('Error de red');
        
        const delTx = db.transaction(STORE_NAME, 'readwrite');
        delTx.objectStore(STORE_NAME).delete(record.id);
        enviados++;

      } catch (error) {
        console.error("Fallo al enviar registro:", error);
        break; 
      }
    }

    updatePendingCount(); 
    if (loadingOverlay) { loadingOverlay.classList.add('d-none'); }
    
    if (enviados > 0) {
        Swal.fire({ icon: 'success', title: 'Completado', text: `¡Se enviaron ${enviados} registro(s) con éxito al servidor!`, confirmButtonColor: '#b38e5d' });
    } else {
        Swal.fire({ icon: 'error', title: 'Error', text: 'Hubo un problema de conexión. Intenta de nuevo más tarde.', confirmButtonColor: '#b38e5d' });
    }
  };
}

// 8. Auto-guardado de borradores al navegar
document.addEventListener('DOMContentLoaded', () => {
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
        const formId = form.id;
        if (!formId) return;

        const draft = sessionStorage.getItem('borrador_' + formId);
        if (draft) {
            const data = JSON.parse(draft);
            for (let key in data) {
                const field = form.elements[key];
                if (field && field.type !== 'file') {
                    if (field.type === 'checkbox' || field.type === 'radio') {
                        if (field.length) { 
                            field.forEach(f => { if (data[key].includes(f.value)) f.checked = true; });
                        } else {
                            field.checked = data[key];
                        }
                    } else {
                        field.value = data[key];
                        if (field.tagName === 'SELECT') field.dispatchEvent(new Event('change'));
                    }
                }
            }
        }

        form.addEventListener('input', e => {
            if (e.target.type === 'file') return; 
            const formData = new FormData(form);
            const data = {};
            for (let [key, value] of formData.entries()) {
                if (data[key]) {
                    if (!Array.isArray(data[key])) data[key] = [data[key]];
                    data[key].push(value);
                } else {
                    data[key] = value;
                }
            }
            sessionStorage.setItem('borrador_' + formId, JSON.stringify(data));
        });
    });
});
