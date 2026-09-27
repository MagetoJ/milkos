import type { ReactNode } from 'react';

/** Two-column layout shared by the sign-in, recovery and MFA pages. */
export default function AuthShell({ eyebrow, title, intro, children, wide = false }: {
  eyebrow: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="auth-page">
      <section className={`auth-panel${wide ? ' register-panel' : ''}`}>
        <div className="auth-brand"><span className="brand-mark">M</span>MaziwaCollect</div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {intro && <p className="auth-intro">{intro}</p>}
        {children}
      </section>
      <aside className="auth-aside">
        <div className="aside-rule" />
        <p>Every litre recorded, every payment traceable.</p>
        <span>MULTI-TENANT MILK COLLECTION PLATFORM</span>
      </aside>
    </div>
  );
}
