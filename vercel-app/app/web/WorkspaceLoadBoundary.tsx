'use client';

import { Component, type ReactNode } from 'react';
import type { SupportedLang } from '@/lib/i18n';
import styles from './web.module.css';

const copy = {
  fr: { title: 'Cet outil n’a pas pu s’ouvrir', body: 'Une mise à jour ou une interruption réseau peut empêcher son chargement. Vous pouvez revenir aux outils ou recharger l’application.', reload: 'Recharger l’application', back: 'Revenir aux outils' },
  en: { title: 'This tool could not open', body: 'An update or a network interruption may have stopped loading. Return to the tools or reload the application.', reload: 'Reload application', back: 'Back to tools' },
  es: { title: 'No se pudo abrir esta herramienta', body: 'Una actualización o una interrupción de red puede impedir la carga. Vuelve a las herramientas o recarga la aplicación.', reload: 'Recargar la aplicación', back: 'Volver a las herramientas' },
};

/** A failed lazy module must not take down navigation or leave a permanent spinner. */
export class WorkspaceLoadBoundary extends Component<{ children: ReactNode; language: SupportedLang; onBack: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    const text = copy[this.props.language] ?? copy.en;
    return <section className={styles.loadingBlock} role="alert">
      <h2>{text.title}</h2><p>{text.body}</p>
      <div className={styles.loadRecoveryActions}>
        <button type="button" onClick={this.props.onBack}>{text.back}</button>
        <button type="button" onClick={() => window.location.reload()}>{text.reload}</button>
      </div>
    </section>;
  }
}
