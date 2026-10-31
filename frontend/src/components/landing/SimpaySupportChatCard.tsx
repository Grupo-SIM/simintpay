'use client';

import { useEffect, useState } from 'react';

const messages = [
  'Oi! Preciso de ajuda com uma operação.',
  'Já localizamos. Estamos resolvendo para você.',
  'Nossa, foi muito mais rápido do que eu esperava.',
] as const;

export function SimpaySupportChatCard() {
  const [typedMessages, setTypedMessages] = useState<[string, string, string]>([
    '',
    '',
    '',
  ]);

  useEffect(() => {
    let messageIndex = 0;
    let characterIndex = 0;
    let timeoutId: ReturnType<typeof setTimeout>;

    const writeNextCharacter = () => {
      const message = messages[messageIndex];
      characterIndex += 1;
      setTypedMessages((current) => {
        const next = [...current] as [string, string, string];
        next[messageIndex] = message.slice(0, characterIndex);
        return next;
      });

      if (characterIndex < message.length) {
        timeoutId = setTimeout(writeNextCharacter, 32);
        return;
      }

      messageIndex += 1;
      characterIndex = 0;
      if (messageIndex < messages.length)
        timeoutId = setTimeout(writeNextCharacter, 450);
    };

    timeoutId = setTimeout(writeNextCharacter, 400);
    return () => clearTimeout(timeoutId);
  }, []);

  return (
    <div
      className="sim-support-chat-card"
      role="img"
      aria-label="Atendimento rápido da SimIntPay"
    >
      <div className="sim-support-chat-card-shadow" />
      <div className="sim-support-chat-card-panel" />
      <div className="sim-support-chat-avatar">
        <img
          src="https://images.unsplash.com/photo-1568602471122-7832951cc4c5?w=300&h=300&fit=crop"
          alt="Cliente SimIntPay"
        />
      </div>
      <div className="sim-support-chat-bubble sim-support-chat-bubble--customer">
        {typedMessages[0]}
      </div>
      <div className="sim-support-chat-bubble sim-support-chat-bubble--agent">
        <div className="sim-support-chat-mark" aria-hidden="true">
          <img src="/Group 4.svg" alt="" />
        </div>
        <div className="sim-support-chat-agent-message">
          <span className="sim-support-chat-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M4 4h16v11H9l-5 4V4Z" fill="currentColor" />
            </svg>
          </span>
          <span>{typedMessages[1]}</span>
        </div>
      </div>
      <div className="sim-support-chat-bubble sim-support-chat-bubble--reply">
        <svg
          className="sim-support-chat-search"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle
            cx="11"
            cy="11"
            r="7"
            stroke="currentColor"
            strokeWidth="2.2"
          />
          <path
            d="m16.2 16.2 4.8 4.8"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
        <span>{typedMessages[2]}</span>
        <svg
          className="sim-support-chat-arrow"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4 12h15m-6-6 6 6-6 6"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}
