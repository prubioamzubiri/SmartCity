import { el } from './dom.js';
import { t } from '../i18n/index.js';

// Chatbot de la ciudad: un botón abajo a la derecha que abre una conversación. Solo aparece cuando el servidor dice que
// está activo (`chat.enabled` en /api/state); mientras tanto no hay nada en el visor.
export function createChat({ sync }) {
  let history = [];
  let busy = false;
  const log = el('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite' });
  const input = el('textarea', { class: 'chat-input', rows: 1, placeholder: t('Escribe una pregunta…'), 'aria-label': t('Pregunta') });
  const send = el('button', { type: 'button', class: 'chat-send', textContent: t('Enviar'), onclick: () => ask() });
  const title = el('span', { class: 'chat-title' });
  const panel = el('div', { class: 'chat-panel', hidden: true },
    el('div', { class: 'chat-head' }, title,
      el('button', { type: 'button', class: 'chat-close', textContent: '✕', title: t('Cerrar'), onclick: () => toggle(false) })),
    log,
    el('div', { class: 'chat-form' }, input, send));
  const button = el('button', { type: 'button', class: 'chat-button', title: t('Asistente'), 'aria-label': t('Abrir el asistente'), textContent: '💬', onclick: () => toggle() });
  const root = el('div', { class: 'chat', hidden: true }, panel, button);
  document.body.append(root);

  function toggle(open = panel.hidden) {
    panel.hidden = !open;
    button.hidden = open;
    if (open) input.focus();
  }

  function add(kind, text) {
    log.append(el('div', { class: `chat-msg ${kind}`, textContent: text }));
    log.scrollTop = log.scrollHeight;
  }

  async function ask() {
    const text = input.value.trim();
    if (!text || busy || !sync.client) return;
    input.value = '';
    history.push({ role: 'user', content: text });
    add('user', text);
    busy = true;
    send.disabled = true;
    const waiting = el('div', { class: 'chat-msg bot pending', textContent: '…' });
    log.append(waiting);
    try {
      const { reply } = await sync.client.chat(history.slice(-20));
      history.push({ role: 'assistant', content: reply });
      waiting.remove();
      add('bot', reply);
    } catch (err) {
      history.pop();
      waiting.remove();
      add('error', err.message || t('No se ha podido preguntar'));
    } finally {
      busy = false;
      send.disabled = false;
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ask();
    }
  });

  return {
    // Estado del servidor: aparece al activarse y desaparece (y olvida la conversación) al desactivarse.
    update(chat) {
      const on = Boolean(chat?.enabled);
      if (!on && !root.hidden) {
        history = [];
        log.replaceChildren();
        toggle(false);
      }
      root.hidden = !on;
      title.textContent = chat?.title || t('Asistente');
      button.title = title.textContent;
    },
  };
}
