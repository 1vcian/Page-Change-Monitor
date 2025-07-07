/**
 * Page Change Monitor - Content Script
 * 
 * Questo script gestisce il monitoraggio delle modifiche nelle pagine web.
 * Include gestione degli errori per il contesto dell'estensione invalidato,
 * che può verificarsi quando l'estensione viene ricaricata o aggiornata mentre è in uso.
 * 
 * Ogni chiamata a chrome.runtime è protetta da try-catch e verifica della validità del contesto
 * tramite il controllo di chrome.runtime.id per evitare errori di tipo "Extension context invalidated".
 */

let selection = {
    isSelecting: false,
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    active: false
  };
  
  let selectionBox = null;
  let originalScreenshot = null;
  let overlay = null;
  let persistentSelectionBox = null; // Bordo permanente dell'area selezionata
  let similarityThreshold = 95; // Threshold personalizzabile
  
  // Identificatore unico per questo tab
  const tabId = Math.random().toString(36).substr(2, 9);
  
  // Carica il threshold personalizzato dal storage
  chrome.storage.local.get(['similarityThreshold'], function(data) {
    if (data.similarityThreshold !== undefined) {
      similarityThreshold = data.similarityThreshold;
    }
  });
  
  // Ascolta eventi dal popup
  document.addEventListener('startSelection', function() {
    startAreaSelection();
  });
  
  // Verifica se html2canvas è disponibile all'avvio
document.addEventListener('DOMContentLoaded', function() {
  if (typeof html2canvas === 'undefined') {
    console.error('❌ ATTENZIONE: html2canvas non è disponibile! Il monitoraggio potrebbe non funzionare correttamente.');
    
    // Verifica se siamo su un sito con restrizioni CSP come YouTube
    const isRestrictedSite = window.location.hostname.includes('youtube.com') || 
                             window.location.hostname.includes('google.com') ||
                             document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    
    if (isRestrictedSite) {
      console.warn('⚠️ Rilevato sito con restrizioni di Content Security Policy. Alcune funzionalità potrebbero non funzionare correttamente.');
      
      // Notifica l'utente delle limitazioni
      try {
        chrome.runtime.sendMessage({
          action: 'showError',
          error: 'Questo sito ha restrizioni di sicurezza che potrebbero limitare il funzionamento dell\'estensione. Prova su un altro sito.'
        });
      } catch (error) {
        console.warn('Impossibile inviare notifica di restrizioni CSP:', error);
      }
    }
  } else {
    console.log('✅ html2canvas è disponibile, versione:', html2canvas.version || 'sconosciuta');
  }
  
  // Gestione errori di caricamento immagini
  window.addEventListener('error', function(event) {
    if (event.target && (event.target.tagName === 'IMG' || event.target.tagName === 'SCRIPT')) {
      console.warn(`⚠️ Errore di caricamento ${event.target.tagName}:`, event.target.src);
      // Non bloccare l'esecuzione dell'estensione per questi errori
      event.stopPropagation();
      event.preventDefault();
    }
  }, true);
});

  // Ascolta messaggi dal background script
try {
  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    // Verifica se il contesto dell'estensione è ancora valido prima di elaborare il messaggio
    try {
      if (!chrome.runtime || !chrome.runtime.id) {
        console.warn('Impossibile elaborare il messaggio: contesto dell\'estensione non valido');
        return;
      }
      
      if (message.action === 'captureArea') {
        captureSelectedArea();
        // Invia una risposta per confermare che la cattura è stata avviata
        try {
          sendResponse({started: true});
        } catch (responseError) {
          console.warn('Impossibile inviare risposta di conferma cattura:', responseError);
        }
        return true; // Indica che la risposta sarà asincrona
      } else if (message.action === 'compareArea') {
        compareSelectedArea();
        // Invia una risposta per confermare che il confronto è stato completato
        try {
          sendResponse({completed: true});
        } catch (responseError) {
          console.warn('Impossibile inviare risposta:', responseError);
        }
        return true; // Indica che la risposta sarà asincrona
      } else if (message.action === 'playNotificationSound') {
        playNotificationSound();
      } else if (message.action === 'updateThreshold') {
        similarityThreshold = message.threshold;
        console.log(`🎯 Threshold aggiornato a ${similarityThreshold}% per tab ${tabId}`);
      } else if (message.action === 'startSelection') {
        console.log('Ricevuta richiesta di avvio selezione area');
        startAreaSelection();
        return true;
      } else if (message.action === 'checkScreenshot') {
        // Verifica se lo screenshot originale esiste
        chrome.storage.local.get(['originalScreenshot'], function(data) {
          try {
            sendResponse({hasScreenshot: !!data.originalScreenshot});
          } catch (responseError) {
            console.warn('Impossibile inviare risposta di verifica screenshot:', responseError);
          }
        });
        return true; // Indica che la risposta sarà asincrona
      }
    } catch (error) {
      console.warn('Errore durante l\'elaborazione del messaggio:', error);
    }
  });
} catch (error) {
  console.warn('Impossibile registrare il listener per i messaggi:', error);
}
  
  function playNotificationSound() {
    try {
      // Verifica se il contesto dell'estensione è ancora valido
      if (!chrome.runtime || !chrome.runtime.id) {
        console.warn('Impossibile riprodurre il suono: contesto dell\'estensione non valido');
        // Fallback: usa un beep del sistema
        playFallbackBeep();
        return;
      }
      
      // Crea un elemento audio per riprodurre il suono
      const audio = document.createElement('audio');
      try {
        audio.src = chrome.runtime.getURL('notification.mp3');
        audio.volume = 0.7;
        audio.play().catch(error => {
          console.log('Impossibile riprodurre il suono di notifica:', error);
          // Fallback: usa un beep del sistema
          playFallbackBeep();
        });
      } catch (audioError) {
        console.warn('Errore nell\'accesso alle risorse dell\'estensione:', audioError);
        // Fallback: usa un beep del sistema
        playFallbackBeep();
      }
    } catch (error) {
      console.error('Errore nella riproduzione del suono:', error);
    }
  }
  
  function playFallbackBeep() {
    try {
      const context = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = context.createOscillator();
      const gainNode = context.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(context.destination);
      
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.3, context.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.5);
      
      oscillator.start(context.currentTime);
      oscillator.stop(context.currentTime + 0.5);
    } catch (beepError) {
      console.log('Impossibile riprodurre anche il beep di fallback:', beepError);
    }
  }
  
  function startAreaSelection() {
    // Pulisci completamente qualsiasi selezione precedente
    cancelSelection();
    
    // Reset dello stato di selezione con proprietà aggiuntive
    selection = {
      isSelecting: false,
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 0,
      active: false,
      clickTime: 0,  // Per tracciare la durata del click
      hasMoved: false // Per verificare se l'utente ha effettivamente trascinato
    };
    
    // Crea overlay per la selezione
    overlay = document.createElement('div');
    overlay.id = 'selection-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
    overlay.style.zIndex = '10000';
    overlay.style.cursor = 'crosshair';
    overlay.style.userSelect = 'none';
    overlay.style.pointerEvents = 'auto';
    document.body.appendChild(overlay);
    
    // Aggiungi istruzioni
    const instructions = document.createElement('div');
    instructions.style.position = 'fixed';
    instructions.style.top = '20px';
    instructions.style.left = '50%';
    instructions.style.transform = 'translateX(-50%)';
    instructions.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    instructions.style.color = 'white';
    instructions.style.padding = '10px 20px';
    instructions.style.borderRadius = '5px';
    instructions.style.zIndex = '10002';
    instructions.style.fontSize = '14px';
    instructions.style.fontFamily = 'Arial, sans-serif';
    instructions.textContent = 'Trascina per selezionare l\'area da monitorare. Premi ESC per annullare.';
    overlay.appendChild(instructions);
    
    selectionBox = document.createElement('div');
    selectionBox.style.position = 'fixed';
    selectionBox.style.border = '2px solid #ff4444';
    selectionBox.style.backgroundColor = 'rgba(255, 68, 68, 0.1)';
    selectionBox.style.zIndex = '10001';
    selectionBox.style.display = 'none';
    selectionBox.style.pointerEvents = 'none';
    document.body.appendChild(selectionBox);
    
    selection.isSelecting = true;
    selection.active = false;
    selection.startX = 0;
    selection.startY = 0;
    selection.endX = 0;
    selection.endY = 0;
    
    overlay.addEventListener('mousedown', handleMouseDown);
    overlay.addEventListener('mousemove', handleMouseMove);
    overlay.addEventListener('mouseup', handleMouseUp);
    
    // Aggiungi listener per ESC
    document.addEventListener('keydown', handleEscapeKey);
  }
  
  function handleEscapeKey(e) {
    if (e.key === 'Escape' && selection.isSelecting) {
      cancelSelection();
    }
  }
  
  function cancelSelection() {
    // Rimuovi tutti gli event listeners
    document.removeEventListener('keydown', handleEscapeKey);
    document.removeEventListener('mousedown', handleMouseDown);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    
    // Rimuovi overlay e selection box
    if (overlay) {
      overlay.removeEventListener('mousedown', handleMouseDown);
      overlay.removeEventListener('mousemove', handleMouseMove);
      overlay.removeEventListener('mouseup', handleMouseUp);
      overlay.remove();
      overlay = null;
    }
    if (selectionBox) {
      selectionBox.remove();
      selectionBox = null;
    }
    
    // Reset completo dello stato
    selection = {
      isSelecting: false,
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 0,
      active: false
    };
    
    // Ripristina il cursore del body
    document.body.style.cursor = 'default';
  }
  
  function createPersistentSelectionBox(selectionData) {
    // Rimuovi il bordo precedente se esiste
    if (persistentSelectionBox) {
      persistentSelectionBox.remove();
    }
    
    // Crea il nuovo bordo permanente
    persistentSelectionBox = document.createElement('div');
    persistentSelectionBox.id = 'persistent-selection-box';
    persistentSelectionBox.style.position = 'fixed';
    persistentSelectionBox.style.left = `${selectionData.left}px`;
    persistentSelectionBox.style.top = `${selectionData.top}px`;
    persistentSelectionBox.style.width = `${selectionData.width}px`;
    persistentSelectionBox.style.height = `${selectionData.height}px`;
    persistentSelectionBox.style.border = '3px solid #ff6b6b';
    persistentSelectionBox.style.backgroundColor = 'rgba(255, 107, 107, 0.1)';
    persistentSelectionBox.style.zIndex = '9999';
    persistentSelectionBox.style.pointerEvents = 'none';
    persistentSelectionBox.style.borderRadius = '4px';
    persistentSelectionBox.style.boxShadow = '0 0 10px rgba(255, 107, 107, 0.5)';
    
    // Aggiungi un'etichetta
    const label = document.createElement('div');
    label.textContent = `🔍 Area Monitorata (${selectionData.width}x${selectionData.height})`;
    label.style.position = 'absolute';
    label.style.top = '-30px';
    label.style.left = '0';
    label.style.backgroundColor = '#ff6b6b';
    label.style.color = 'white';
    label.style.padding = '4px 8px';
    label.style.borderRadius = '4px';
    label.style.fontSize = '12px';
    label.style.fontWeight = 'bold';
    label.style.whiteSpace = 'nowrap';
    label.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
    
    persistentSelectionBox.appendChild(label);
    document.body.appendChild(persistentSelectionBox);
    
    console.log(`🎯 Bordo permanente creato per area ${selectionData.width}x${selectionData.height} | TAB: ${tabId}`);
  }
  
  function handleMouseDown(e) {
    if (!selection.isSelecting) return;
    
    e.preventDefault();
    selection.active = true;
    selection.startX = e.clientX;
    selection.startY = e.clientY;
    
    // Registra il timestamp del click per verificare se è stato rilasciato troppo velocemente
    selection.clickTime = Date.now();
    
    selectionBox.style.left = `${selection.startX}px`;
    selectionBox.style.top = `${selection.startY}px`;
    selectionBox.style.width = '0';
    selectionBox.style.height = '0';
    selectionBox.style.display = 'block';
    
    console.log(`Mouse down: ${selection.startX},${selection.startY}`);
  }
  
  function handleMouseMove(e) {
    if (!selection.isSelecting || !selection.active) return;
    
    e.preventDefault();
    selection.endX = e.clientX;
    selection.endY = e.clientY;
    
    // Verifica se l'utente ha effettivamente spostato il mouse di almeno 5 pixel
    const movedX = Math.abs(selection.endX - selection.startX);
    const movedY = Math.abs(selection.endY - selection.startY);
    
    if (movedX > 5 || movedY > 5) {
      selection.hasMoved = true;
    }
    
    // Calcola dimensioni e posizione del box
    const left = Math.min(selection.startX, selection.endX);
    const top = Math.min(selection.startY, selection.endY);
    const width = Math.abs(selection.endX - selection.startX);
    const height = Math.abs(selection.endY - selection.startY);
    
    // Assicuriamoci che il box sia sempre visibile
    selectionBox.style.display = 'block';
    selectionBox.style.left = `${left}px`;
    selectionBox.style.top = `${top}px`;
    selectionBox.style.width = `${width}px`;
    selectionBox.style.height = `${height}px`;
    
    // Mostra le dimensioni nell'overlay
    const instructions = overlay.querySelector('div');
    if (instructions && width > 0 && height > 0) {
      instructions.textContent = `Area: ${width}x${height}px - Rilascia per confermare, ESC per annullare`;
    }
  }
  
  function handleMouseUp(e) {
    if (!selection.isSelecting || !selection.active) return;
    
    e.preventDefault();
    selection.endX = e.clientX;
    selection.endY = e.clientY;
    
    // Calcola le coordinate finali
    const left = Math.min(selection.startX, selection.endX);
    const top = Math.min(selection.startY, selection.endY);
    const width = Math.abs(selection.endX - selection.startX);
    const height = Math.abs(selection.endY - selection.startY);
    
    // Log per diagnosticare il problema
    console.log(`Mouse up: ${selection.endX},${selection.endY}`);
    console.log(`Dimensioni area selezionata: ${width}x${height}px`);
    
    // Verifica se il click è stato rilasciato troppo velocemente (meno di 100ms)
    // o se le coordinate di inizio e fine sono identiche o se l'utente non ha trascinato
    const clickDuration = Date.now() - (selection.clickTime || 0);
    const sameCoordinates = selection.startX === selection.endX && selection.startY === selection.endY;
    
    if (width < 5 || height < 5 || sameCoordinates || clickDuration < 100 || !selection.hasMoved) {
      // Mostra messaggio di errore
      const instructions = overlay.querySelector('div');
      if (instructions) {
        // Messaggio più specifico per aiutare l'utente
        let errorMessage = 'Area troppo piccola! ';
        if (sameCoordinates) {
          errorMessage += 'Clicca e trascina per creare un\'area.';
        } else {
          errorMessage += 'Seleziona un\'area più grande.';
        }
        
        instructions.textContent = errorMessage;
        instructions.style.backgroundColor = 'rgba(255, 0, 0, 0.8)';
        setTimeout(() => {
          if (instructions) {
            instructions.textContent = 'Trascina per selezionare l\'area da monitorare. Premi ESC per annullare.';
            instructions.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
          }
        }, 2000);
      }
      selection.active = false;
      selectionBox.style.display = 'none';
      return;
    }
    
    // Salva le coordinate dell'area selezionata
    const selectionData = {
      left: left,
      top: top,
      width: width,
      height: height
    };
    
    chrome.storage.local.set({selectedArea: selectionData}, function() {
      console.log('Area selezionata salvata:', selectionData);
    });
    
    // Crea il bordo permanente prima di pulire la selezione
    createPersistentSelectionBox(selectionData);
    
    // Pulisci la selezione
    cancelSelection();
    
    // Informa che la selezione è completata
    // Verifica se il contesto dell'estensione è ancora valido prima di inviare il messaggio
    try {
      if (chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage({action: 'selectionComplete'});
      } else {
        console.warn('Impossibile inviare messaggio: contesto dell\'estensione non valido');
      }
    } catch (error) {
      console.warn('Errore durante l\'invio del messaggio:', error);
    }
  }
  
  function captureSelectedArea() {
  try {
    // Verifica se il contesto dell'estensione è ancora valido
    if (!chrome.runtime || !chrome.runtime.id) {
      console.warn('Impossibile catturare l\'area: contesto dell\'estensione non valido');
      return;
    }
    
    console.log('🔍 Inizio cattura area selezionata');
    
    // Ottieni le coordinate dell'area selezionata
    chrome.storage.local.get(['selectedArea'], function(data) {
      if (!data.selectedArea) {
        console.error('❌ Nessuna area selezionata trovata nello storage');
        try {
          chrome.runtime.sendMessage({action: 'screenshotError'});
        } catch (sendError) {
          console.warn('Impossibile inviare notifica di errore:', sendError);
          // Fallback: mostra un alert all'utente
          alert('Errore: Nessuna area selezionata. Riprova a selezionare un\'area.');
        }
        return;
      }
      
      const area = data.selectedArea;
      console.log('📏 Area selezionata recuperata:', area);
      
      // Verifica che l'area selezionata sia valida
      if (!area.width || !area.height || area.width <= 0 || area.height <= 0) {
        console.error('❌ Area selezionata non valida:', area);
        try {
          chrome.runtime.sendMessage({action: 'screenshotError'});
        } catch (sendError) {
          console.warn('Impossibile inviare notifica di errore:', sendError);
          alert('Errore: Area selezionata non valida. Riprova a selezionare un\'area più grande.');
        }
        return;
      }
      
      // Cattura screenshot dell'area selezionata con gestione degli errori migliorata
      captureAreaScreenshot(area).then(screenshot => {
        if (!screenshot) {
          console.error('❌ Screenshot non generato dalla funzione captureAreaScreenshot');
          try {
            chrome.runtime.sendMessage({action: 'screenshotError'});
          } catch (sendError) {
            console.warn('Impossibile inviare notifica di errore:', sendError);
            alert('Errore nella generazione dell\'immagine. Riprova su un\'area diversa della pagina.');
          }
          return;
        }
        
        console.log('📸 Screenshot originale catturato, dimensione:', screenshot.length);
        
        // Verifica se il contesto è ancora valido prima di salvare
        try {
          if (chrome.runtime && chrome.runtime.id) {
            // Salva lo screenshot come riferimento originale
            chrome.storage.local.set({originalScreenshot: screenshot}, function() {
              if (chrome.runtime.lastError) {
                console.error('❌ Errore durante il salvataggio dello screenshot:', chrome.runtime.lastError);
                try {
                  chrome.runtime.sendMessage({action: 'screenshotError'});
                } catch (sendError) {
                  console.warn('Impossibile inviare notifica di errore:', sendError);
                }
                return;
              }
              
              // Verifica che lo screenshot sia stato effettivamente salvato
              chrome.storage.local.get(['originalScreenshot'], function(checkData) {
                if (checkData.originalScreenshot) {
                  console.log('✅ Screenshot originale salvato con successo, dimensione:', checkData.originalScreenshot.length);
                } else {
                  console.error('❌ Screenshot non trovato dopo il salvataggio!');
                  try {
                    chrome.runtime.sendMessage({action: 'screenshotError'});
                  } catch (sendError) {
                    console.warn('Impossibile inviare notifica di errore:', sendError);
                  }
                }
              });
            });
          } else {
            console.warn('Impossibile salvare screenshot: contesto dell\'estensione non valido');
            alert('Errore: Impossibile salvare lo screenshot. Ricarica la pagina e riprova.');
          }
        } catch (error) {
          console.error('❌ Errore durante il salvataggio dello screenshot:', error);
          try {
            chrome.runtime.sendMessage({action: 'screenshotError'});
          } catch (sendError) {
            console.warn('Impossibile inviare notifica di errore:', sendError);
            alert('Si è verificato un errore durante il salvataggio. Ricarica la pagina e riprova.');
          }
        }
      }).catch(error => {
        console.error('❌ Errore nella cattura dello screenshot:', error);
        try {
          chrome.runtime.sendMessage({action: 'screenshotError'});
        } catch (sendError) {
          console.warn('Impossibile inviare notifica di errore:', sendError);
          alert('Errore nella cattura dello screenshot. Riprova su un\'area diversa della pagina.');
        }
      });
    });
  } catch (error) {
    console.error('❌ Errore durante la cattura dell\'area:', error);
    try {
      chrome.runtime.sendMessage({action: 'screenshotError'});
    } catch (sendError) {
      console.warn('Impossibile inviare notifica di errore:', sendError);
      alert('Si è verificato un errore durante la cattura dell\'area. Ricarica la pagina e riprova.');
    }
  }
}
  
  function compareSelectedArea() {
    try {
      // Verifica se il contesto dell'estensione è ancora valido
      if (!chrome.runtime || !chrome.runtime.id) {
        console.warn('Impossibile eseguire il confronto: contesto dell\'estensione non valido');
        return;
      }
      
      console.log('🔄 Inizio confronto area selezionata');
      
      chrome.storage.local.get(['selectedArea', 'originalScreenshot'], function(data) {
        // Log dettagliato dei dati recuperati
        console.log('📊 Dati recuperati dallo storage:', {
          hasArea: !!data.selectedArea,
          hasScreenshot: !!data.originalScreenshot,
          areaDetails: data.selectedArea ? `${data.selectedArea.width}x${data.selectedArea.height}` : 'nessuna',
          screenshotSize: data.originalScreenshot ? data.originalScreenshot.length : 0
        });
        
        if (!data.selectedArea) {
          console.error('❌ Area selezionata mancante nello storage');
          return;
        }
        
        if (!data.originalScreenshot) {
          console.error('❌ Screenshot originale mancante nello storage');
          // Tenta di ricatturare lo screenshot originale
          console.log('🔄 Tentativo di ricattura dello screenshot originale...');
          captureSelectedArea();
          return;
        }
        
        const area = data.selectedArea;
        const originalScreenshot = data.originalScreenshot;
        
        console.log('📏 Utilizzo area:', area);
        
        // Cattura screenshot dell'area selezionata allo stato attuale
        captureAreaScreenshot(area).then(currentScreenshot => {
          if (!currentScreenshot) {
            console.error('❌ Impossibile catturare screenshot attuale');
            return;
          }
          
          console.log('🔍 Confronto screenshot... Dimensioni - Originale:', originalScreenshot.length, 'Attuale:', currentScreenshot.length);
          
          // Ripristina il bordo permanente dopo ogni aggiornamento della pagina
          createPersistentSelectionBox(area);
          
          // Confronta gli screenshot
          compareScreenshots(originalScreenshot, currentScreenshot).then(similarity => {
            // Console error per il logging della similitudine (come richiesto)
            console.error(`🔍 SIMILITUDINE: ${similarity.toFixed(2)}% | THRESHOLD: ${similarityThreshold}% | TAB: ${tabId}`);
            
            // Usa il threshold personalizzabile
            if (similarity < similarityThreshold) {
              console.error(`🚨 CAMBIAMENTO RILEVATO! Similarità: ${similarity.toFixed(2)}% (sotto threshold ${similarityThreshold}%) | TAB: ${tabId}`);
              
              // Crea una pagina di confronto visivo
              createComparisonPage(originalScreenshot, currentScreenshot, similarity);
              
              // Verifica se il contesto dell'estensione è ancora valido prima di inviare il messaggio
              try {
                if (chrome.runtime && chrome.runtime.id) {
                  chrome.runtime.sendMessage({action: 'changeDetected'});
                } else {
                  console.warn('Impossibile inviare messaggio di cambiamento: contesto dell\'estensione non valido');
                }
              } catch (error) {
                console.warn('❌ Errore durante l\'invio del messaggio di cambiamento:', error);
              }
            } else {
              console.log('✅ Nessun cambiamento significativo rilevato. Similarità:', similarity + '%');
            }
          }).catch(error => {
            console.error('❌ Errore nel confronto degli screenshot:', error);
          });
        }).catch(error => {
          console.error('❌ Errore nel confronto:', error);
        });
      });
    } catch (error) {
      console.error('❌ Errore durante l\'esecuzione del confronto:', error);
    }
  }
  
  async function captureAreaScreenshot(area) {
    try {
      // Verifica se html2canvas è disponibile
      if (typeof html2canvas === 'undefined') {
        console.error('❌ html2canvas non è disponibile! Impossibile catturare screenshot');
        return createFallbackScreenshot(area);
      }
      
      console.log('📸 Tentativo di cattura screenshot dell\'area:', area);
      
      // Usa html2canvas per catturare l'area specifica con opzioni migliorate
      const canvas = await html2canvas(document.body, {
        x: area.left + window.scrollX,
        y: area.top + window.scrollY,
        width: area.width,
        height: area.height,
        useCORS: true,
        allowTaint: true,
        scale: 1,
        backgroundColor: null,
        imageTimeout: 10000, // Timeout aumentato per pagine complesse
        logging: true, // Attiva il logging per debug
        ignoreElements: (element) => {
          // Ignora gli elementi dell'estensione e quelli problematici
          return element.id === 'selection-overlay' || 
                 element.id === 'selection-box' || 
                 element.id === 'persistent-selection-box' ||
                 element.tagName === 'IFRAME' || // Ignora iframe che possono causare problemi di sicurezza
                 element.tagName === 'OBJECT' || // Ignora elementi che possono causare problemi
                 element.tagName === 'EMBED';
        },
        onclone: function(documentClone) {
          try {
            // Rimuovi elementi problematici dal clone prima della cattura
            const problematicElements = documentClone.querySelectorAll('iframe, canvas, video, object, embed');
            problematicElements.forEach(function(element) {
              try {
                // Sostituisci con un placeholder o nascondi
                element.style.visibility = 'hidden';
              } catch (e) {
                // Ignora errori di manipolazione DOM
              }
            });
          } catch (e) {
            console.warn('⚠️ Avviso durante la preparazione del clone:', e);
          }
          return documentClone;
        }
      }).catch(error => {
        console.error('❌ Errore durante l\'esecuzione di html2canvas:', error);
        return null;
      });
      
      if (!canvas) {
        console.error('❌ Canvas non generato da html2canvas, utilizzo fallback');
        return createFallbackScreenshot(area);
      }
      
      try {
        const dataUrl = canvas.toDataURL('image/png');
        console.log('✅ Screenshot catturato con successo, dimensione dati:', dataUrl.length);
        return dataUrl;
      } catch (dataUrlError) {
        console.error('❌ Errore nella generazione del dataURL:', dataUrlError);
        // Tentativo di fallback con formato diverso
        try {
          console.log('🔄 Tentativo di fallback con formato JPEG...');
          const jpegDataURL = canvas.toDataURL('image/jpeg', 0.8);
          if (jpegDataURL && jpegDataURL !== 'data:,' && jpegDataURL.length > 100) {
            console.log('✅ Fallback riuscito con JPEG, dimensione:', jpegDataURL.length);
            return jpegDataURL;
          }
        } catch (fallbackError) {
          console.error('❌ Anche il fallback è fallito:', fallbackError);
        }
        return createFallbackScreenshot(area);
      }
    } catch (error) {
      console.error('❌ Errore nella cattura dello screenshot:', error);
      return createFallbackScreenshot(area);
    }
  }
  
  // Funzione di fallback per creare uno screenshot alternativo
  function createFallbackScreenshot(area) {
    console.log('⚠️ Utilizzo metodo fallback per la creazione dello screenshot');
    try {
      // Crea un canvas manualmente
      const canvas = document.createElement('canvas');
      canvas.width = area.width;
      canvas.height = area.height;
      const ctx = canvas.getContext('2d');
      
      // Riempi con un colore di sfondo
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Aggiungi un testo informativo
      ctx.fillStyle = '#333';
      ctx.font = '14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Impossibile catturare l\'area selezionata', canvas.width / 2, canvas.height / 2 - 20);
      ctx.fillText('Riprova con un\'area diversa', canvas.width / 2, canvas.height / 2);
      ctx.fillText('o su un altro sito web', canvas.width / 2, canvas.height / 2 + 20);
      
      // Aggiungi informazioni sul sito
      ctx.font = '12px Arial';
      ctx.fillStyle = '#999';
      const siteName = window.location.hostname || 'sito sconosciuto';
      ctx.fillText('Sito: ' + siteName, canvas.width / 2, canvas.height - 20);
      
      // Aggiungi un bordo
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 3;
      ctx.strokeRect(0, 0, canvas.width, canvas.height);
      
      try {
        const dataUrl = canvas.toDataURL('image/png');
        if (dataUrl && dataUrl !== 'data:,' && dataUrl.length > 100) {
          console.log('✅ Screenshot fallback creato, dimensione:', dataUrl.length);
          return dataUrl;
        }
        
        // Se PNG fallisce, prova con JPEG
        const jpegURL = canvas.toDataURL('image/jpeg', 0.8);
        if (jpegURL && jpegURL !== 'data:,' && jpegURL.length > 100) {
          console.log('✅ Screenshot fallback creato con successo (JPEG)');
          return jpegURL;
        }
      } catch (dataUrlError) {
        console.error('❌ Errore nella generazione del dataURL:', dataUrlError);
      }
      
      // Crea un dataURL minimo valido per un'immagine 1x1 trasparente
      return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    } catch (fallbackError) {
      console.error('❌ Anche il metodo fallback è fallito:', fallbackError);
      // Crea un dataURL minimo valido per un'immagine 1x1 trasparente
      return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    }
  }
  
  function compareScreenshots(screenshot1, screenshot2) {
    try {
      // Crea due canvas per confrontare i pixel
      const canvas1 = document.createElement('canvas');
      const canvas2 = document.createElement('canvas');
      const ctx1 = canvas1.getContext('2d');
      const ctx2 = canvas2.getContext('2d');
      
      const img1 = new Image();
      const img2 = new Image();
      
      return new Promise((resolve) => {
        let loadedCount = 0;
        
        function onImageLoad() {
          loadedCount++;
          if (loadedCount === 2) {
            // Imposta le dimensioni dei canvas
            canvas1.width = img1.width;
            canvas1.height = img1.height;
            canvas2.width = img2.width;
            canvas2.height = img2.height;
            
            // Disegna le immagini sui canvas
            ctx1.drawImage(img1, 0, 0);
            ctx2.drawImage(img2, 0, 0);
            
            // Ottieni i dati dei pixel
            const data1 = ctx1.getImageData(0, 0, canvas1.width, canvas1.height).data;
            const data2 = ctx2.getImageData(0, 0, canvas2.width, canvas2.height).data;
            
            // Confronta i pixel
            let matchingPixels = 0;
            const totalPixels = data1.length / 4; // Diviso per 4 perché ogni pixel ha RGBA
            
            for (let i = 0; i < data1.length; i += 4) {
              const r1 = data1[i], g1 = data1[i + 1], b1 = data1[i + 2];
              const r2 = data2[i], g2 = data2[i + 1], b2 = data2[i + 2];
              
              // Calcola la differenza di colore
              const diff = Math.sqrt(
                Math.pow(r1 - r2, 2) + 
                Math.pow(g1 - g2, 2) + 
                Math.pow(b1 - b2, 2)
              );
              
              // Se la differenza è piccola, considera i pixel simili
              if (diff < 30) { // Soglia di tolleranza
                matchingPixels++;
              }
            }
            
            const similarity = (matchingPixels / totalPixels) * 100;
            resolve(Math.round(similarity * 100) / 100);
          }
        }
        
        img1.onload = onImageLoad;
        img2.onload = onImageLoad;
        img1.src = screenshot1;
        img2.src = screenshot2;
      });
    } catch (error) {
      console.error('Errore nel confronto degli screenshot:', error);
      return 0;
    }
  }
  
  function createComparisonPage(originalScreenshot, currentScreenshot, similarity) {
    // Crea il contenuto HTML per la pagina di confronto
    const comparisonHTML = `
      <!DOCTYPE html>
      <html lang="it">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>🔍 Confronto Cambiamenti - Page Change Monitor</title>
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
          }
          .container {
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            border-radius: 15px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            overflow: hidden;
          }
          .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
          }
          .header h1 {
            margin: 0;
            font-size: 2.5em;
            font-weight: 300;
          }
          .similarity {
            background: ${similarity < similarityThreshold ? '#e74c3c' : '#27ae60'};
            color: white;
            padding: 15px 30px;
            margin: 20px 0;
            border-radius: 25px;
            display: inline-block;
            font-size: 1.2em;
            font-weight: bold;
          }
          .comparison-container {
            display: flex;
            padding: 30px;
            gap: 30px;
          }
          .image-section {
            flex: 1;
            text-align: center;
          }
          .image-section h2 {
            color: #333;
            margin-bottom: 20px;
            font-size: 1.5em;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 10px;
            border-left: 5px solid #667eea;
          }
          .image-container {
            border: 3px solid #ddd;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 10px 20px rgba(0,0,0,0.1);
            margin-bottom: 20px;
          }
          .image-container img {
            width: 100%;
            height: auto;
            display: block;
          }
          .base64-section {
            background: #f8f9fa;
            border-radius: 10px;
            padding: 15px;
            margin-top: 20px;
          }
          .base64-section h3 {
            color: #333;
            margin-top: 0;
            font-size: 1.2em;
          }
          .base64-content {
            background: #2c3e50;
            color: #ecf0f1;
            padding: 15px;
            border-radius: 8px;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            word-break: break-all;
            max-height: 200px;
            overflow-y: auto;
            border: 1px solid #34495e;
          }
          .copy-btn {
            background: #3498db;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            margin-top: 10px;
            font-size: 14px;
            transition: background 0.3s;
          }
          .copy-btn:hover {
            background: #2980b9;
          }
          .stats {
            background: #f8f9fa;
            padding: 20px;
            margin: 20px 30px;
            border-radius: 10px;
            border-left: 5px solid #e74c3c;
          }
          .stats h3 {
            color: #333;
            margin-top: 0;
          }
          @media (max-width: 768px) {
            .comparison-container {
              flex-direction: column;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔍 Confronto Cambiamenti Rilevati</h1>
            <div class="similarity">
              Similarità: ${similarity.toFixed(2)}% ${similarity < similarityThreshold ? '⚠️ CAMBIAMENTO RILEVATO' : '✅ NESSUN CAMBIAMENTO'}
            </div>
          </div>
          
          <div class="stats">
            <h3>📊 Statistiche del Confronto</h3>
            <p><strong>Data e Ora:</strong> ${new Date().toLocaleString('it-IT')}</p>
            <p><strong>Soglia di Rilevamento:</strong> ${similarityThreshold}%</p>
            <p><strong>Differenza Rilevata:</strong> ${(100 - similarity).toFixed(2)}%</p>
            <p><strong>Stato:</strong> ${similarity < similarityThreshold ? '🔴 Cambiamento Significativo' : '🟢 Nessun Cambiamento'}</p>
          </div>
          
          <div class="comparison-container">
            <div class="image-section">
              <h2>📸 Immagine Originale (Prima)</h2>
              <div class="image-container">
                <img src="${originalScreenshot}" alt="Screenshot Originale" />
              </div>
              <div class="base64-section">
                <h3>🔢 Dati Base64 - Originale</h3>
                <div class="base64-content" id="original-base64">${originalScreenshot}</div>
                <button class="copy-btn" onclick="copyToClipboard('original-base64')">📋 Copia Base64</button>
              </div>
            </div>
            
            <div class="image-section">
              <h2>📸 Immagine Attuale (Dopo)</h2>
              <div class="image-container">
                <img src="${currentScreenshot}" alt="Screenshot Attuale" />
              </div>
              <div class="base64-section">
                <h3>🔢 Dati Base64 - Attuale</h3>
                <div class="base64-content" id="current-base64">${currentScreenshot}</div>
                <button class="copy-btn" onclick="copyToClipboard('current-base64')">📋 Copia Base64</button>
              </div>
            </div>
          </div>
        </div>
        
        <script>
          function copyToClipboard(elementId) {
            const element = document.getElementById(elementId);
            const text = element.textContent;
            
            navigator.clipboard.writeText(text).then(function() {
              // Feedback visivo
              const button = element.nextElementSibling;
              const originalText = button.textContent;
              button.textContent = '✅ Copiato!';
              button.style.background = '#27ae60';
              
              setTimeout(() => {
                button.textContent = originalText;
                button.style.background = '#3498db';
              }, 2000);
            }).catch(function(err) {
              console.error('Errore nella copia:', err);
              alert('Errore nella copia del testo');
            });
          }
        </script>
      </body>
      </html>
    `;
    
    // Apri una nuova scheda con il confronto
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.write(comparisonHTML);
      newWindow.document.close();
    } else {
      console.error('Impossibile aprire una nuova scheda. Popup bloccato?');
    }
  }