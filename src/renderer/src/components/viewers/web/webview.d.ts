import 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      /** Electron <webview> (enabled via `webviewTag` in main/window.ts). */
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        partition?: string;
        allowpopups?: string;
        useragent?: string;
      };
    }
  }
}
