// Variabili globali per il monitoraggio multi-tab
let tabMonitors = new Map(); // Mappa per tenere traccia dei monitor per ogni tab

// Struttura per ogni monitor di tab
function createTabMonitor(tabId) {
  return {
    tabId: tabId,
    refreshCount: 0,
    isMonitoring: false,
    timeoutId: null
  };
}

// Ascolta messaggi dal popup e dal content script
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.action === 'startMonitoring') {
    startMonitoring();
  } else if (message.action === 'stopMonitoring') {
    stopMonitoring();
  } else if (message.action === 'startSelection') {
    // Inoltra il messaggio al content script del tab attivo
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {action: 'startSelection'});
      }
    });
  } else if (message.action === 'selectionComplete') {
    captureInitialArea();
    // Propaga il messaggio a tutti i tab aperti, incluso il popup
    chrome.runtime.sendMessage({action: 'selectionComplete'});
  } else if (message.action === 'changeDetected') {
    handleChangeDetected();
  } else if (message.action === 'screenshotError') {
    // Notifica l'utente del problema con lo screenshot
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'images/icon128.png',
      title: 'Errore di Monitoraggio',
      message: 'Impossibile catturare lo screenshot originale. Prova a selezionare nuovamente l\'area.',
      priority: 2
    });
    
    // Invia anche un messaggio al popup per mostrare l'errore
    chrome.runtime.sendMessage({
      action: 'showError',
      error: 'Impossibile catturare lo screenshot originale. Prova a selezionare nuovamente l\'area.'
    });
  } else if (message.action === 'getActiveSessions') {
    // Restituisce tutte le sessioni di monitoraggio attive
    sendResponse(getActiveSessions());
  } else if (message.action === 'stopMonitoringForTab') {
    // Ferma il monitoraggio per un tab specifico
    if (message.tabId) {
      stopMonitoringForTab(message.tabId);
      sendResponse({success: true, message: `Monitoraggio fermato per tab ${message.tabId}`});
    } else {
      sendResponse({success: false, message: 'Nessun ID tab fornito'});
    }
  }
  
  // Importante: ritorna true per indicare che sendResponse potrebbe essere chiamato in modo asincrono
  return true;
});

function startMonitoring() {
  chrome.storage.local.get(['delayAfterLoad', 'tabId', 'similarityThreshold'], function(data) {
    const tabId = data.tabId;
    if (!tabId) {
      console.error('❌ Nessun tab ID trovato');
      // Notifica l'utente del problema
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'images/icon48.png',
        title: 'Errore di Monitoraggio',
        message: 'Nessun tab ID trovato. Riapri il popup e riprova.'
      });
      return;
    }
    
    // Verifica che il tab esista ancora
    chrome.tabs.get(tabId, function(tab) {
      if (chrome.runtime.lastError || !tab) {
        console.error('❌ Tab non più disponibile:', chrome.runtime.lastError);
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'images/icon48.png',
          title: 'Errore di Monitoraggio',
          message: 'Il tab selezionato non è più disponibile. Riapri il popup e riprova.'
        });
        return;
      }
      
      // Controlla se questo tab è già in monitoraggio
      if (tabMonitors.has(tabId) && tabMonitors.get(tabId).isMonitoring) {
        console.log(`🔄 Monitoraggio già attivo per tab ${tabId}`);
        return;
      }
      
      // Crea o aggiorna il monitor per questo tab
      const monitor = tabMonitors.get(tabId) || createTabMonitor(tabId);
      monitor.isMonitoring = true;
      monitor.refreshCount = 0;
      tabMonitors.set(tabId, monitor);
      
      const delayTime = (data.delayAfterLoad || 3) * 1000;
      const threshold = data.similarityThreshold || 95;
      
      console.log(`🚀 Avvio monitoraggio per tab ${tabId} con delay di ${delayTime}ms e threshold ${threshold}%`);
      
      // Invia il threshold al content script con gestione degli errori
      try {
        chrome.tabs.sendMessage(tabId, {
          action: 'updateThreshold',
          threshold: threshold
        }, function(response) {
          if (chrome.runtime.lastError) {
            console.warn('⚠️ Avviso: Impossibile aggiornare il threshold nel content script:', chrome.runtime.lastError);
            // Continua comunque con il monitoraggio
          }
        });
      } catch (error) {
        console.error('❌ Errore nell\'invio del threshold:', error);
        // Continua comunque con il monitoraggio
      }
      
      // Verifica se lo screenshot originale esiste già
      chrome.storage.local.get(['originalScreenshot'], function(screenshotData) {
        if (!screenshotData.originalScreenshot) {
          console.log('📸 Nessuno screenshot originale trovato, avvio cattura iniziale...');
          // Cattura l'area selezionata inizialmente
          captureInitialArea();
          
          // Verifica dopo un breve ritardo che lo screenshot sia stato salvato prima di avviare il monitoraggio
          setTimeout(function() {
            chrome.storage.local.get(['originalScreenshot'], function(checkData) {
              if (checkData.originalScreenshot) {
                console.log('✅ Screenshot originale verificato, avvio monitoraggio continuo');
                // Avvia il monitoraggio continuo
                startContinuousMonitoring(tabId, delayTime);
              } else {
                console.error('❌ Screenshot originale ancora mancante dopo il tentativo di cattura');
                // Invia un messaggio al content script per verificare lo stato con gestione degli errori
                try {
                  chrome.tabs.sendMessage(tabId, {action: 'checkScreenshot'}, function(response) {
                    if (chrome.runtime.lastError) {
                      console.error('❌ Errore nella comunicazione con il content script:', chrome.runtime.lastError);
                      // Notifica l'utente del problema
                      chrome.notifications.create({
                        type: 'basic',
                        iconUrl: 'images/icon48.png',
                        title: 'Errore di Monitoraggio',
                        message: 'Impossibile comunicare con la pagina. Ricarica la pagina e riprova.'
                      });
                      return;
                    }
                    
                    if (response && response.hasScreenshot) {
                      console.log('✅ Screenshot trovato nel content script, avvio monitoraggio');
                      startContinuousMonitoring(tabId, delayTime);
                    } else {
                      console.error('❌ Impossibile avviare il monitoraggio: screenshot mancante');
                      // Notifica l'utente del problema
                      chrome.notifications.create({
                        type: 'basic',
                        iconUrl: 'images/icon48.png',
                        title: 'Errore di Monitoraggio',
                        message: 'Impossibile catturare lo screenshot. Riprova a selezionare l\'area.'
                      });
                      chrome.runtime.sendMessage({action: 'screenshotError'});
                    }
                  });
                } catch (error) {
                  console.error('❌ Eccezione durante la verifica dello screenshot:', error);
                  // Notifica l'utente del problema
                  chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'images/icon48.png',
                    title: 'Errore di Monitoraggio',
                    message: 'Si è verificato un errore. Ricarica la pagina e riprova.'
                  });
                }
              }
            });
          }, 3000); // Attendi 3 secondi per dare tempo alla cattura di completarsi
        } else {
          console.log('✅ Screenshot originale già presente, dimensione:', screenshotData.originalScreenshot.length);
          // Avvia direttamente il monitoraggio continuo
          startContinuousMonitoring(tabId, delayTime);
        }
      });
    });
  });
}

function captureInitialArea() {
  chrome.storage.local.get(['tabId'], function(data) {
    if (!data.tabId) {
      console.error('❌ Nessun tabId trovato per la cattura iniziale');
      // Notifica l'utente del problema
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'images/icon48.png',
        title: 'Errore di Monitoraggio',
        message: 'Nessun tab ID trovato. Riapri il popup e riprova.'
      });
      return;
    }
    
    console.log('📸 Richiesta cattura area iniziale per tab', data.tabId);
    
    // Verifica che il tab esista ancora prima di inviare il messaggio
    chrome.tabs.get(data.tabId, function(tab) {
      if (chrome.runtime.lastError || !tab) {
        console.error('❌ Tab non più disponibile:', chrome.runtime.lastError);
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'images/icon48.png',
          title: 'Errore di Monitoraggio',
          message: 'Il tab selezionato non è più disponibile. Riapri il popup e riprova.'
        });
        return;
      }
      
      // Invia il messaggio con gestione degli errori
      try {
        chrome.tabs.sendMessage(data.tabId, {action: 'captureArea'}, function(response) {
          if (chrome.runtime.lastError) {
            console.error('❌ Errore nell\'invio del messaggio al content script:', chrome.runtime.lastError);
          }
        });
        
        // Verifica dopo un breve ritardo che lo screenshot sia stato salvato
        setTimeout(function() {
          chrome.storage.local.get(['originalScreenshot'], function(checkData) {
            if (!checkData.originalScreenshot) {
              console.error('❌ Screenshot originale non trovato dopo la cattura iniziale, nuovo tentativo...');
              // Ritenta la cattura con un secondo tentativo
              try {
                chrome.tabs.sendMessage(data.tabId, {action: 'captureArea'}, function(response) {
                  if (chrome.runtime.lastError) {
                    console.error('❌ Errore nel secondo tentativo di cattura:', chrome.runtime.lastError);
                    // Notifica l'utente del problema persistente
                    chrome.notifications.create({
                      type: 'basic',
                      iconUrl: 'images/icon48.png',
                      title: 'Errore di Monitoraggio',
                      message: 'Impossibile catturare lo screenshot. Ricarica la pagina e riprova.'
                    });
                  }
                });
              } catch (error) {
                console.error('❌ Eccezione durante il secondo tentativo di cattura:', error);
              }
            } else {
              console.log('✅ Screenshot originale verificato, dimensione:', checkData.originalScreenshot.length);
            }
          });
        }, 2000); // Attendi 2 secondi per dare tempo alla cattura di completarsi
      } catch (error) {
        console.error('❌ Eccezione durante la richiesta di cattura:', error);
      }
    });
  });
}

function startContinuousMonitoring(tabId, delayTime) {
  const monitor = tabMonitors.get(tabId);
  if (!monitor || !monitor.isMonitoring) {
    console.log(`Monitoraggio fermato per tab ${tabId}`);
    return;
  }
  
  // Verifica se il tab esiste ancora
  chrome.tabs.get(tabId, function(tab) {
    if (chrome.runtime.lastError || !tab) {
      console.log(`Tab ${tabId} non più disponibile, fermo il monitoraggio`);
      stopMonitoringForTab(tabId);
      // Notifica l'utente
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'images/icon48.png',
        title: 'Monitoraggio Interrotto',
        message: `Il tab monitorato (${tabId}) non è più disponibile.`
      });
      return;
    }
    
    // Verifica che lo screenshot originale esista prima di procedere
    chrome.storage.local.get(['originalScreenshot'], function(data) {
      if (!data.originalScreenshot) {
        console.error('❌ Screenshot originale mancante prima del controllo #' + (monitor.refreshCount + 1));
        // Tenta di ricatturare lo screenshot
        captureInitialArea();
        // Continua comunque con il monitoraggio, ma con un avviso
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'images/icon48.png',
          title: 'Avviso Monitoraggio',
          message: 'Screenshot di riferimento mancante. Tentativo di ricattura in corso.'
        });
      }
      
      // Incrementa il contatore di controlli per questo tab
      monitor.refreshCount++;
      
      // Aggiorna il contatore nel popup (solo se è il tab attivo) con gestione degli errori
      try {
        chrome.tabs.query({active: true, currentWindow: true}, function(activeTabs) {
          if (chrome.runtime.lastError) {
            console.warn('⚠️ Errore nella query dei tab attivi:', chrome.runtime.lastError);
            return;
          }
          
          if (activeTabs[0] && activeTabs[0].id === tabId) {
            try {
              chrome.runtime.sendMessage({
                action: 'updateCount',
                count: monitor.refreshCount
              }, function(response) {
                if (chrome.runtime.lastError) {
                  console.warn('⚠️ Errore nell\'aggiornamento del contatore nel popup:', chrome.runtime.lastError);
                }
              });
              
              // Aggiorna il contatore nello storage
              chrome.storage.local.set({refreshCount: monitor.refreshCount});
            } catch (error) {
              console.error('❌ Eccezione durante l\'aggiornamento del contatore:', error);
            }
          }
        });
      } catch (error) {
        console.error('❌ Eccezione durante la query dei tab attivi:', error);
      }

      console.log(`🔄 Controllo #${monitor.refreshCount} per tab ${tabId} - Aggiornamento pagina e confronto`);
      
      // Aggiorna la pagina prima del confronto con gestione degli errori
      try {
        chrome.tabs.reload(tabId, function() {
          if (chrome.runtime.lastError) {
            console.error('❌ Errore durante il ricaricamento della pagina:', chrome.runtime.lastError);
            // Continua comunque con il monitoraggio dopo un breve ritardo
            if (monitor.isMonitoring) {
              monitor.timeoutId = setTimeout(() => startContinuousMonitoring(tabId, delayTime), 5000);
            }
            return;
          }
          
          // Aspetta che la pagina si carichi completamente
          monitor.timeoutId = setTimeout(function() {
            if (monitor.isMonitoring) {
              try {
                chrome.tabs.sendMessage(tabId, {action: 'compareArea'}, function(response) {
                  if (chrome.runtime.lastError) {
                    console.error('❌ Errore durante il confronto dell\'area:', chrome.runtime.lastError);
                    // Verifica se l'errore è dovuto a un problema di connessione con il content script
                    if (chrome.runtime.lastError.message && 
                        (chrome.runtime.lastError.message.includes('Receiving end does not exist') ||
                         chrome.runtime.lastError.message.includes('Extension context invalidated'))) {
                      // Notifica l'utente del problema
                      chrome.notifications.create({
                        type: 'basic',
                        iconUrl: 'images/icon48.png',
                        title: 'Errore di Monitoraggio',
                        message: 'Problema di comunicazione con la pagina. Il monitoraggio continuerà al prossimo ciclo.'
                      });
                    }
                    
                    // Continua comunque con il monitoraggio dopo un breve ritardo
                    if (monitor.isMonitoring) {
                      monitor.timeoutId = setTimeout(() => startContinuousMonitoring(tabId, delayTime), 5000);
                    }
                    return;
                  }
                  
                  // Continua il monitoraggio solo se non è stato rilevato un cambiamento
                  if (monitor.isMonitoring) {
                    // Aspetta un po' prima del prossimo controllo per non sovraccaricare
                    monitor.timeoutId = setTimeout(() => startContinuousMonitoring(tabId, delayTime), 3000);
                  }
                });
              } catch (error) {
                console.error('❌ Eccezione durante il confronto dell\'area:', error);
                // Continua comunque con il monitoraggio dopo un breve ritardo
                if (monitor.isMonitoring) {
                  monitor.timeoutId = setTimeout(() => startContinuousMonitoring(tabId, delayTime), 5000);
                }
              }
            }
          }, delayTime);
        });
      } catch (error) {
        console.error('❌ Eccezione durante il ricaricamento della pagina:', error);
        // Continua comunque con il monitoraggio dopo un breve ritardo
        if (monitor.isMonitoring) {
          monitor.timeoutId = setTimeout(() => startContinuousMonitoring(tabId, delayTime), 5000);
        }
      }
    });
  });
}


function stopMonitoring() {
  chrome.storage.local.get(['tabId'], function(data) {
    if (data.tabId) {
      stopMonitoringForTab(data.tabId);
    }
  });
}

function stopMonitoringForTab(tabId) {
  console.log(`🛑 Fermo il monitoraggio per tab ${tabId}`);
  
  const monitor = tabMonitors.get(tabId);
  if (monitor) {
    monitor.isMonitoring = false;
    if (monitor.timeoutId) {
      clearTimeout(monitor.timeoutId);
      monitor.timeoutId = null;
    }
    monitor.refreshCount = 0;
  }
  
  // Aggiorna lo storage solo se è il tab attivo
  chrome.tabs.query({active: true, currentWindow: true}, function(activeTabs) {
    if (activeTabs[0] && activeTabs[0].id === tabId) {
      chrome.storage.local.set({
        isMonitoring: false,
        refreshCount: 0
      });
    }
  });
  
  // Notifica il popup dell'aggiornamento delle sessioni attive
  chrome.runtime.sendMessage({action: 'sessionsUpdated'});
}

// Funzione per ottenere tutte le sessioni di monitoraggio attive
function getActiveSessions() {
  const activeSessions = [];
  
  // Converti la Map in un array di oggetti
  for (const [tabId, monitor] of tabMonitors.entries()) {
    if (monitor.isMonitoring) {
      activeSessions.push({
        tabId: tabId,
        refreshCount: monitor.refreshCount
      });
    }
  }
  
  return activeSessions;
}

function handleChangeDetected() {
  chrome.storage.local.get(['tabId'], function(data) {
    const tabId = data.tabId;
    if (!tabId) return;
    
    console.log(`🚨 Cambiamento rilevato per tab ${tabId}!`);
    
    // Ferma il monitoraggio per questo tab
    stopMonitoringForTab(tabId);
    
    // Invia messaggio al popup
    chrome.runtime.sendMessage({action: 'changeDetected'});
    
    // Riproduci suono di notifica sul tab specifico
    chrome.tabs.sendMessage(tabId, {action: 'playNotificationSound'});
    
    // Crea notifica del browser
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'images/icon48.png',
      title: 'Page Change Monitor',
      message: `Cambiamento rilevato nella pagina monitorata! (Tab ${tabId})`
    });
  });
}

// Ripristina il monitoraggio dopo che Chrome è stato riavviato
chrome.runtime.onStartup.addListener(function() {
  chrome.storage.local.get(['isMonitoring'], function(data) {
    if (data.isMonitoring) {
      startMonitoring();
    }
  });
});