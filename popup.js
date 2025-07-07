document.addEventListener('DOMContentLoaded', function() {
    const startSelectionBtn = document.getElementById('startSelection');
    const startMonitoringBtn = document.getElementById('startMonitoring');
    const stopMonitoringBtn = document.getElementById('stopMonitoring');
    const statusText = document.getElementById('status');
    const refreshCountText = document.getElementById('refreshCount');
    const delayAfterLoadInput = document.getElementById('delayAfterLoad');
    const similarityThresholdInput = document.getElementById('similarityThreshold');
    const sessionsListDiv = document.getElementById('sessionsList');
    const refreshSessionsBtn = document.getElementById('refreshSessions');
    
    let isSelecting = false;
    let isMonitoring = false;
    
    // Verifica se il sito corrente ha restrizioni CSP
    checkForCSPRestrictions();
    
    // Controlla se c'è un monitoraggio attivo
    chrome.storage.local.get(['isMonitoring', 'refreshCount', 'selectedArea', 'delayAfterLoad', 'similarityThreshold'], function(data) {
      if (data.isMonitoring) {
        isMonitoring = true;
        startMonitoringBtn.disabled = true;
        stopMonitoringBtn.disabled = false;
        statusText.textContent = 'Monitoraggio attivo';
        refreshCountText.textContent = data.refreshCount || '0';
      }
      
      // Se un'area è già stata selezionata, abilita il pulsante di monitoraggio
      if (data.selectedArea) {
        startMonitoringBtn.disabled = false;
        statusText.textContent = 'Area selezionata, pronto per il monitoraggio';
      }
      
      // Imposta il valore del delay se presente
      if (data.delayAfterLoad) {
        delayAfterLoadInput.value = data.delayAfterLoad;
      }
      
      // Imposta il valore del threshold se presente
      if (data.similarityThreshold !== undefined) {
        similarityThresholdInput.value = data.similarityThreshold;
      }
    });
    
    startSelectionBtn.addEventListener('click', function() {
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        const activeTab = tabs[0];
        chrome.scripting.executeScript({
          target: {tabId: activeTab.id},
          func: initiateSelection
        });
        
        statusText.textContent = 'Seleziona un\'area della pagina';
        window.close();
      });
    });
    
    startMonitoringBtn.addEventListener('click', function() {
      const delayTime = parseInt(delayAfterLoadInput.value, 10) || 3;
      const threshold = parseFloat(similarityThresholdInput.value) || 95;
      
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        const activeTab = tabs[0];
        chrome.storage.local.set({
          isMonitoring: true,
          tabId: activeTab.id,
          tabUrl: activeTab.url,
          delayAfterLoad: delayTime,
          similarityThreshold: threshold,
          refreshCount: 0
        });
        
        chrome.runtime.sendMessage({action: 'startMonitoring'});
        
        statusText.textContent = 'Monitoraggio attivo - in attesa di cambiamenti...';
        refreshCountText.textContent = '0';
        startMonitoringBtn.disabled = true;
        stopMonitoringBtn.disabled = false;
      });
    });
    
    stopMonitoringBtn.addEventListener('click', function() {
      chrome.runtime.sendMessage({action: 'stopMonitoring'});
      chrome.storage.local.set({isMonitoring: false});
      
      statusText.textContent = 'Monitoraggio fermato';
      startMonitoringBtn.disabled = false;
      stopMonitoringBtn.disabled = true;
    });
    
    // Funzione per aggiornare la lista delle sessioni attive
    function updateSessionsList() {
      chrome.runtime.sendMessage({action: 'getActiveSessions'}, function(sessions) {
        sessionsListDiv.innerHTML = '';
        
        if (sessions && sessions.length > 0) {
          sessions.forEach(session => {
            const sessionDiv = document.createElement('div');
            sessionDiv.className = 'session-item';
            
            // Ottieni informazioni sul tab
            chrome.tabs.get(session.tabId, function(tab) {
              if (chrome.runtime.lastError) {
                // Il tab potrebbe non esistere più
                sessionDiv.innerHTML = `
                  <div class="session-info">
                    <p>Tab ID: ${session.tabId} (non più disponibile)</p>
                    <p>Controlli: ${session.refreshCount}</p>
                  </div>
                  <button class="stop-session" data-tabid="${session.tabId}">⏹️ Ferma</button>
                `;
              } else {
                // Il tab esiste, mostra le informazioni
                sessionDiv.innerHTML = `
                  <div class="session-info">
                    <p>Tab: ${tab.title ? tab.title.substring(0, 30) + (tab.title.length > 30 ? '...' : '') : 'Tab senza titolo'}</p>
                    <p>URL: ${tab.url ? tab.url.substring(0, 30) + (tab.url.length > 30 ? '...' : '') : 'URL non disponibile'}</p>
                    <p>Controlli: ${session.refreshCount}</p>
                  </div>
                  <button class="stop-session" data-tabid="${session.tabId}">⏹️ Ferma</button>
                `;
              }
              
              sessionsListDiv.appendChild(sessionDiv);
              
              // Aggiungi event listener al pulsante di stop
              const stopBtn = sessionDiv.querySelector('.stop-session');
              stopBtn.addEventListener('click', function() {
                const tabId = parseInt(this.getAttribute('data-tabid'), 10);
                chrome.runtime.sendMessage(
                  {action: 'stopMonitoringForTab', tabId: tabId},
                  function(response) {
                    if (response && response.success) {
                      updateSessionsList();
                    }
                  }
                );
              });
            });
          });
        } else {
          sessionsListDiv.innerHTML = '<p class="no-sessions">Nessuna sessione attiva</p>';
        }
      });
    }
    
    // Aggiorna la lista delle sessioni quando si apre il popup
    updateSessionsList();
    
    // Aggiungi event listener al pulsante di aggiornamento sessioni
    refreshSessionsBtn.addEventListener('click', updateSessionsList);
    
    // Ricevi aggiornamenti dal background script
    chrome.runtime.onMessage.addListener(function(message) {
      if (message.action === 'updateCount') {
        refreshCountText.textContent = message.count;
      } else if (message.action === 'selectionComplete') {
        startMonitoringBtn.disabled = false;
        statusText.textContent = 'Area selezionata, pronto per il monitoraggio';
      } else if (message.action === 'changeDetected') {
        statusText.textContent = 'Cambiamento rilevato!';
        stopMonitoringBtn.disabled = true;
        startMonitoringBtn.disabled = false;
      } else if (message.action === 'showError') {
        statusText.textContent = 'Errore: ' + message.error;
      } else if (message.action === 'sessionsUpdated') {
        // Aggiorna la lista delle sessioni quando riceve una notifica di aggiornamento
        updateSessionsList();
      }
    });
    
    // Verifica se il sito corrente ha restrizioni CSP che potrebbero causare problemi
    function checkForCSPRestrictions() {
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs[0]) {
          const url = tabs[0].url;
          const restrictedDomains = ['youtube.com', 'www.youtube.com', 'google.com', 'www.google.com'];
          
          // Verifica se l'URL contiene uno dei domini con restrizioni note
          const isRestricted = restrictedDomains.some(domain => url.includes(domain));
          
          if (isRestricted) {
            showWarning('Questo sito ha restrizioni di sicurezza che potrebbero limitare il funzionamento dell\'estensione. Considera di usare l\'estensione su un altro sito.');
          }
        }
      });
    }
    
    // Mostra un avviso all'utente
    function showWarning(message) {
      const warningElement = document.getElementById('warning-message');
      
      // Se l'elemento non esiste, crealo
      if (!warningElement) {
        const warningDiv = document.createElement('div');
        warningDiv.id = 'warning-message';
        warningDiv.style.backgroundColor = '#FFF3CD';
        warningDiv.style.color = '#856404';
        warningDiv.style.padding = '10px';
        warningDiv.style.marginBottom = '15px';
        warningDiv.style.borderRadius = '4px';
        warningDiv.style.fontSize = '14px';
        warningDiv.style.border = '1px solid #FFEEBA';
        
        const container = document.querySelector('.container');
        container.insertBefore(warningDiv, container.firstChild);
      }
      
      // Aggiorna il messaggio
      document.getElementById('warning-message').textContent = message;
    }
  });
  
  function initiateSelection() {
    // Informa il content script di iniziare la selezione
    document.dispatchEvent(new CustomEvent('startSelection'));
    // Invia anche un messaggio al content script come backup
    chrome.runtime.sendMessage({action: 'startSelection'});
    return true; // Necessario per le funzioni eseguite con executeScript
  }