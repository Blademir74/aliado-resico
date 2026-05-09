/* ============================================
   ALIADO RESICO — Chat Simulator (WhatsApp)
   Real-time classification + auto responses
   ============================================ */

const Chat = (() => {
  const messagesEl = () => document.getElementById('chat-messages');
  const inputEl = () => document.getElementById('chat-input');

  function escapeHTML(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function formatTime() {
    return new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  }

  // --- Add a chat bubble ---
  function addBubble(text, type = 'user', extra = '') {
    const el = messagesEl();
    if (!el) return;

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${type}`;
    bubble.innerHTML = `
      <p>${text}</p>
      ${extra}
      <span class="bubble-time">${formatTime()}</span>
    `;
    el.appendChild(bubble);
    el.scrollTop = el.scrollHeight;
    return bubble;
  }

  // --- Typing indicator ---
  function showTyping() {
    const el = messagesEl();
    if (!el) return null;
    const typing = document.createElement('div');
    typing.className = 'typing-indicator';
    typing.id = 'typing-indicator';
    typing.innerHTML = '<span></span><span></span><span></span>';
    el.appendChild(typing);
    el.scrollTop = el.scrollHeight;
    return typing;
  }

  function removeTyping() {
    const t = document.getElementById('typing-indicator');
    if (t) t.remove();
  }

  // --- Update classification panel ---
  function updateClassificationPanel(classification) {
    const empty = document.getElementById('classification-empty');
    const content = document.getElementById('classification-content');
    if (empty) empty.style.display = 'none';
    if (content) content.style.display = 'block';

    const config = window.CATEGORY_CONFIG || {};
    const cat = config[classification.intent] || {};

    const intentEl = document.getElementById('result-intent');
    if (intentEl) {
      intentEl.innerHTML = `<span class="cat-badge ${cat.cssClass || 'otros'}" style="font-size:14px;padding:4px 14px">${cat.icon || '💬'} ${cat.label || classification.intent}</span>`;
    }

    const confBar = document.getElementById('result-confidence-bar');
    const confVal = document.getElementById('result-confidence-val');
    const confPct = Math.round(classification.confidence * 100);
    if (confBar) {
      confBar.style.width = confPct + '%';
      confBar.style.background = cat.color || '#64748b';
    }
    if (confVal) confVal.textContent = confPct + '%';

    const keywordsEl = document.getElementById('result-keywords');
    if (keywordsEl) {
      keywordsEl.innerHTML = (classification.keywords_matched || []).map(k =>
        `<span class="keyword-tag">${escapeHTML(k)}</span>`
      ).join('') || '<span style="color:var(--text-muted);font-size:11px">Ninguno</span>';
    }

    const explEl = document.getElementById('result-explanation');
    if (explEl) explEl.textContent = classification.explanation || '';

    // Source indicator
    const sourceEl = document.getElementById('result-source');
    if (sourceEl) {
      const isGemini = classification.source && classification.source.includes('gemini');
      sourceEl.innerHTML = `<span class="source-badge ${isGemini ? 'gemini' : 'local'}">${isGemini ? '🧠 Gemini' : '⚡ Local'}</span>`;
    }

    // RESICO context
    const resicoEl = document.getElementById('result-resico-context');
    if (resicoEl) {
      if (classification.resico_context) {
        resicoEl.style.display = 'block';
        resicoEl.innerHTML = `<span style="font-size:12px;color:var(--cat-consulta)">📌 ${escapeHTML(classification.resico_context)}</span>`;
      } else {
        resicoEl.style.display = 'none';
      }
    }

    // Salud fiscal alert
    const alertEl = document.getElementById('result-salud-alerta');
    if (alertEl) {
      if (classification.salud_fiscal_alerta) {
        alertEl.style.display = 'block';
        alertEl.innerHTML = `<span style="font-size:12px;color:var(--warning)">⚠️ ${escapeHTML(classification.salud_fiscal_alerta)}</span>`;
      } else {
        alertEl.style.display = 'none';
      }
    }
  }

  // --- Send message (now async for Gemini) ---
  async function sendMessage(text) {
    if (!text || !text.trim()) return;

    const clean = text.trim();

    // User bubble
    addBubble(escapeHTML(clean), 'user');

    // Clear input
    const inp = inputEl();
    if (inp) inp.value = '';

    // Show typing while processing
    showTyping();

    try {
      // Process (async for Gemini)
      const result = await ConversationManager.processMessage(clean);
      const config = window.CATEGORY_CONFIG || {};
      const cat = config[result.classification.intent] || {};

      removeTyping();

      // Category tag on user bubble
      const msgs = messagesEl();
      if (msgs) {
        const userBubbles = msgs.querySelectorAll('.chat-bubble.user');
        const lastBubble = userBubbles[userBubbles.length - 1];
        if (lastBubble) {
          const tagDiv = document.createElement('div');
          tagDiv.className = 'bubble-cat-tag';
          const sourceIcon = result.classification.source?.includes('gemini') ? '🧠' : '⚡';
          tagDiv.innerHTML = `<span class="cat-badge ${cat.cssClass || 'otros'}" style="font-size:10px">${cat.icon || '💬'} ${cat.label || result.classification.intent} · ${Math.round(result.classification.confidence * 100)}% ${sourceIcon}</span>`;
          const pEl = lastBubble.querySelector('p');
          if (pEl) pEl.after(tagDiv);
        }
      }

      // Update panel
      updateClassificationPanel(result.classification);

      // Bot response with typing delay
      showTyping();
      const delay = 600 + Math.random() * 800;
      setTimeout(() => {
        removeTyping();
        const formatted = result.response
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\n/g, '<br>');
        addBubble(formatted, 'bot');
      }, delay);

    } catch (error) {
      removeTyping();
      addBubble(`❌ Error al procesar: ${escapeHTML(error.message)}`, 'bot');
      console.error('[Chat] Processing error:', error);
    }

    // Update badge
    updateChatBadge();
  }

  function updateChatBadge() {
    const badge = document.getElementById('chat-badge');
    if (!badge) return;
    const m = Store.getMetrics();
    if (m.totalProcessed > 0) {
      badge.style.display = 'inline';
      badge.textContent = m.totalProcessed;
    }
  }

  // --- Init ---
  function init() {
    // Send button
    const btnSend = document.getElementById('btn-send');
    if (btnSend) {
      btnSend.addEventListener('click', () => {
        const inp = inputEl();
        if (inp) sendMessage(inp.value);
      });
    }

    // Enter key
    const inp = inputEl();
    if (inp) {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage(inp.value);
        }
      });
    }

    // Quick examples
    const examples = document.getElementById('quick-examples');
    if (examples) {
      examples.addEventListener('click', (e) => {
        const btn = e.target.closest('.quick-example-btn');
        if (btn) {
          const msg = btn.getAttribute('data-msg');
          if (msg) sendMessage(msg);
        }
      });
    }

    // New message button (header)
    const btnNew = document.getElementById('btn-new-message');
    if (btnNew) {
      btnNew.addEventListener('click', () => {
        window.App?.navigateTo('chat');
        setTimeout(() => { const inp2 = inputEl(); if (inp2) inp2.focus(); }, 200);
      });
    }

    updateChatBadge();

    // Show Auditoría de Salud Fiscal on first visit
    if (ConversationManager.shouldShowAudit()) {
      setTimeout(() => {
        const auditMsg = ConversationManager.getAuditMessage();
        const formatted = auditMsg
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\n/g, '<br>');
        addBubble(formatted, 'bot');
      }, 1500);
    }
  }

  return { init, sendMessage, updateChatBadge };
})();

if (typeof window !== 'undefined') window.Chat = Chat;
