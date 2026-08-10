'use client';

import Image from 'next/image';
import { FormEvent, useEffect, useState } from 'react';
import styles from './landing.module.css';
import { LANDING_COPY, LANGUAGE_OPTIONS, type Language } from './landing-copy';

type IconName =
  | 'arrow'
  | 'box'
  | 'camera'
  | 'chart'
  | 'check'
  | 'chevron'
  | 'cloud'
  | 'company'
  | 'document'
  | 'download'
  | 'hardhat'
  | 'history'
  | 'lock'
  | 'map'
  | 'menu'
  | 'message'
  | 'offline'
  | 'plan'
  | 'scan'
  | 'shield'
  | 'spark'
  | 'team'
  | 'x';

function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    box: <path d="m4 7 8-4 8 4-8 4-8-4Zm0 0v10l8 4 8-4V7m-8 4v10" />,
    camera: <><path d="M4 7h3l2-3h6l2 3h3v12H4V7Z" /><circle cx="12" cy="13" r="3.5" /></>,
    chart: <><path d="M4 19V9m6 10V5m6 14v-7m4 7H2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 6 6 6-6 6" />,
    cloud: <path d="M7 18h10a4 4 0 0 0 .4-8A6 6 0 0 0 6 8.5 4.8 4.8 0 0 0 7 18Z" />,
    company: <><path d="M4 21V5h10v16M14 9h6v12M8 9h2m-2 4h2m-2 4h2m8-4h-2m2 4h-2M2 21h20" /></>,
    document: <><path d="M6 3h8l4 4v14H6V3Z" /><path d="M14 3v5h5M9 13h6m-6 4h6" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5" /><path d="M5 20h14" /></>,
    hardhat: <><path d="M4 15a8 8 0 0 1 16 0M8 15V9m8 6V9M3 15h18v4H3v-4Z" /></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5m4-1v5l3 2" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" /><path d="M9 3v15m6-12v15" /></>,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    message: <path d="M4 5h16v12H8l-4 4V5Z" />,
    offline: <><path d="M5 5 19 19M7.5 14.5A4.7 4.7 0 0 0 12 18h5m2-3a4 4 0 0 0-1-5.3A6 6 0 0 0 8.5 6.2" /></>,
    plan: <><path d="M4 4h16v16H4V4Z" /><path d="M8 4v6h6V4m-2 10h8m-8 0v6" /></>,
    scan: <><path d="M4 9V5h4m8 0h4v4M4 15v4h4m8 0h4v-4" /><path d="M8 12h8" /></>,
    shield: <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" />,
    spark: <path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Zm7 13 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" />,
    team: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M3 20a6 6 0 0 1 12 0m0-5a5 5 0 0 1 6 5" /></>,
    x: <path d="m6 6 12 12M18 6 6 18" />,
  };

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={styles.brand} aria-label="BuildTrack">
      <span className={styles.brandMark} aria-hidden="true">
        <Image src="/icon.png" alt="" width={38} height={38} sizes="38px" />
      </span>
      {!compact && <span className={styles.brandWord}>BuildTrack</span>}
    </span>
  );
}

type RoleKey = 'direction' | 'conducteur' | 'magasinier' | 'entreprise';

function LanguageSelector({ language, onChange, compact = false }: { language: Language; onChange: (language: Language) => void; compact?: boolean }) {
  const copy = LANDING_COPY[language];
  return (
    <label className={`${styles.languageSelector} ${compact ? styles.languageSelectorCompact : ''}`}>
      <span className={styles.visuallyHidden}>{copy.accessibility.language}</span>
      <select value={language} onChange={event => onChange(event.target.value as Language)} aria-label={copy.accessibility.language}>
        {LANGUAGE_OPTIONS.map(option => (
          <option key={option.code} value={option.code}>{compact ? option.short : `${option.short} — ${option.label}`}</option>
        ))}
      </select>
    </label>
  );
}

function ProductScene({ copy }: { copy: (typeof LANDING_COPY)[Language] }) {
  return (
    <div className={styles.productScene} aria-label={copy.mock.aria}>
      <div className={styles.sceneGlow} />
      <div className={styles.browserFrame}>
        <div className={styles.browserBar}>
          <div className={styles.windowDots}><i /><i /><i /></div>
          <div className={styles.browserAddress}>{copy.mock.address}</div>
          <div className={styles.browserLive}><span /> {copy.mock.synced}</div>
        </div>
        <div className={styles.appFrame}>
          <aside className={styles.appSidebar}>
            <Brand compact />
            <div className={`${styles.sideIcon} ${styles.sideIconActive}`}><Icon name="chart" size={18} /></div>
            <div className={styles.sideIcon}><Icon name="plan" size={18} /></div>
            <div className={styles.sideIcon}><Icon name="check" size={18} /></div>
            <div className={styles.sideIcon}><Icon name="team" size={18} /></div>
            <div className={styles.sideIcon}><Icon name="box" size={18} /></div>
          </aside>
          <div className={styles.appContent}>
            <div className={styles.appTopline}>
              <div>
                <span>{copy.mock.project}</span>
                <strong>{copy.mock.greeting}</strong>
              </div>
              <div className={styles.avatar}>CM</div>
            </div>
            <div className={styles.kpiRow}>
              <div><small>{copy.mock.progress}</small><strong>73%</strong><span className={styles.kpiRise}>+4.2</span></div>
              <div><small>{copy.mock.openIssues}</small><strong>24</strong><span>{copy.mock.priorityIssues}</span></div>
              <div><small>{copy.mock.teamsOnSite}</small><strong>41</strong><span>{copy.mock.companies}</span></div>
            </div>
            <div className={styles.workspaceGrid}>
              <div className={styles.planPanel}>
                <div className={styles.panelHeader}><strong>{copy.mock.level}</strong><span>{copy.mock.executionPlan}</span></div>
                <svg className={styles.blueprint} viewBox="0 0 520 270" aria-hidden="true">
                  <g className={styles.blueprintWalls}>
                    <path d="M25 30h470v210H25zM160 30v210M350 30v210M25 135h135m190 0h145M160 82h190M255 82v158" />
                    <path d="M55 60h65v48H55zM385 165h75v45h-75zM185 112h44v80h-44z" />
                    <path d="M160 175h22m52 65v-22m116-136h-24m24 104h24" />
                  </g>
                  <g className={styles.planPins}>
                    <circle cx="103" cy="93" r="13" /><text x="103" y="98">3</text>
                    <circle cx="302" cy="154" r="13" /><text x="302" y="159">8</text>
                    <circle cx="426" cy="83" r="13" /><text x="426" y="88">2</text>
                  </g>
                </svg>
                <div className={styles.planLegend}><span><i className={styles.legendRed} /> {copy.mock.toHandle}</span><span><i className={styles.legendGreen} /> {copy.mock.valid}</span></div>
              </div>
              <div className={styles.activityPanel}>
                <div className={styles.panelHeader}><strong>{copy.mock.toHandle}</strong><span>{copy.mock.viewAll}</span></div>
                <div className={styles.activityItem}>
                  <span className={styles.activityCode}>RSV-204</span>
                  <strong>{copy.mock.issueOne}</strong>
                  <small>{copy.mock.issueOneMeta}</small>
                </div>
                <div className={styles.activityItem}>
                  <span className={styles.activityCode}>RSV-197</span>
                  <strong>{copy.mock.issueTwo}</strong>
                  <small>{copy.mock.issueTwoMeta}</small>
                </div>
                <div className={styles.miniProgress}>
                  <div><span>{copy.mock.thisWeek}</span><strong>31 / 42</strong></div>
                  <i><b /></i>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.phoneFrame}>
        <div className={styles.phoneSpeaker} />
        <div className={styles.phoneHeader}><Brand compact /><span>{copy.mock.stockEntry}</span><Icon name="x" size={18} /></div>
        <div className={styles.scannerView}>
          <div className={styles.scanCorners} />
          <div className={styles.scanBeam} />
          <div className={styles.packageArt}><span>DN25</span><i /><i /><b>3 760184 219044</b></div>
        </div>
        <div className={styles.detectedProduct}>
          <span className={styles.detectedCheck}><Icon name="check" size={16} /></span>
          <div><small>{copy.mock.recognized}</small><strong>{copy.mock.product}</strong><span>{copy.mock.reference}</span></div>
        </div>
        <div className={styles.quantityLine}><span>{copy.mock.receivedQuantity}</span><strong>+ 25</strong></div>
        <div className={styles.phoneAction}>{copy.mock.validateEntry}</div>
      </div>

      <div className={styles.sceneNote}>
        <span><Icon name="cloud" size={17} /></span>
        <div><strong>{copy.mock.sameData}</strong><small>{copy.mock.sameDataDetail}</small></div>
      </div>
    </div>
  );
}

export default function LandingPage({ initialLanguage }: { initialLanguage: Language }) {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeRole, setActiveRole] = useState<RoleKey>('conducteur');
  const [formState, setFormState] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [formMessage, setFormMessage] = useState('');

  const copy = LANDING_COPY[language];
  const roleContent = copy.roles.profiles;
  const role = roleContent[activeRole];

  function changeLanguage(nextLanguage: Language) {
    setLanguage(nextLanguage);
    setMenuOpen(false);
    setFormMessage('');
    try {
      localStorage.setItem('buildtrack_landing_language', nextLanguage);
      document.cookie = `buildtrack_landing_language=${nextLanguage}; Path=/; Max-Age=31536000; SameSite=Lax`;
    } catch {
      // The page still switches language when storage is unavailable.
    }
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem('buildtrack_landing_language');
      if ((saved === 'en' || saved === 'fr' || saved === 'es') && saved !== initialLanguage) {
        changeLanguage(saved);
      }
    } catch {
      // Browser storage can be disabled without affecting the landing page.
    }
    // The saved preference is checked once, after hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = copy.meta.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) description.content = copy.meta.description;
  }, [copy.meta.description, copy.meta.title, language]);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>('[data-landing-root]');
    const nodes = document.querySelectorAll<HTMLElement>('[data-reveal]');
    if (!root || !('IntersectionObserver' in window)) return;

    root.classList.add(styles.motionReady);
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add(styles.revealed);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.14, rootMargin: '0px 0px -8% 0px' }
    );
    nodes.forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  async function submitDemoRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormState('sending');
    setFormMessage('');
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());

    try {
      const response = await fetch('/api/demo-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(data.message || copy.demo.fallbackError);
      setFormState('success');
      setFormMessage(data.message || copy.demo.fallbackSuccess);
      form.reset();
    } catch (error) {
      setFormState('error');
      setFormMessage(error instanceof Error ? error.message : copy.demo.fallbackError);
    }
  }

  return (
    <div className={styles.page} data-landing-root>
      <a className={styles.skipLink} href="#contenu">{copy.accessibility.skip}</a>

      <header className={styles.siteHeader}>
        <nav className={styles.navShell} aria-label={copy.accessibility.navigation}>
          <a href="#accueil" className={styles.logoLink} aria-label="BuildTrack"><Brand /></a>
          <div className={styles.desktopNav}>
            <a href="#produit">{copy.nav.product}</a>
            <a href="#metiers">{copy.nav.roles}</a>
            <a href="#fiabilite">{copy.nav.reliability}</a>
            <a href="#faq">{copy.nav.faq}</a>
          </div>
          <div className={styles.navActions}>
            <LanguageSelector language={language} onChange={changeLanguage} />
            <a className={styles.loginLink} href="/web">{copy.nav.login}</a>
            <a className={styles.navCta} href="#demo">{copy.nav.demo} <Icon name="arrow" size={18} /></a>
          </div>
          <div className={styles.mobileHeaderTools}>
            <LanguageSelector language={language} onChange={changeLanguage} compact />
            <button
              className={styles.menuButton}
              type="button"
              aria-label={menuOpen ? copy.accessibility.closeMenu : copy.accessibility.openMenu}
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? 'mobile-navigation' : undefined}
              onClick={() => setMenuOpen(open => !open)}
            >
              <Icon name={menuOpen ? 'x' : 'menu'} />
            </button>
          </div>
        </nav>
        {menuOpen && (
          <div id="mobile-navigation" className={`${styles.mobileNav} ${styles.mobileNavOpen}`}>
            <a href="#produit" onClick={() => setMenuOpen(false)}>{copy.nav.product}</a>
            <a href="#metiers" onClick={() => setMenuOpen(false)}>{copy.nav.roles}</a>
            <a href="#fiabilite" onClick={() => setMenuOpen(false)}>{copy.nav.reliability}</a>
            <a href="#faq" onClick={() => setMenuOpen(false)}>{copy.nav.faq}</a>
            <a href="/web">{copy.nav.login}</a>
            <a className={styles.mobileCta} href="#demo" onClick={() => setMenuOpen(false)}>{copy.nav.demo}</a>
          </div>
        )}
      </header>

      <main id="contenu">
        <section className={styles.hero} id="accueil">
          <div className={styles.heroGrid}>
            <div className={styles.heroCopy}>
              <div className={styles.heroSignal}><span /> {copy.hero.signal}</div>
              <h1>{copy.hero.before}<em>{copy.hero.highlight}</em>{copy.hero.after}</h1>
              <p className={styles.heroLead}>
                {copy.hero.lead}
              </p>
              <div className={styles.heroActions}>
                <a className={styles.primaryButton} href="#demo">{copy.hero.primary} <Icon name="arrow" /></a>
                <a className={styles.textButton} href="#produit"><span className={styles.playIcon}><Icon name="spark" size={17} /></span> {copy.hero.secondary}</a>
              </div>
              <div className={styles.heroAssurance}>
                <span><Icon name="check" size={17} /> {copy.hero.assurance[0]}</span>
                <span><Icon name="check" size={17} /> {copy.hero.assurance[1]}</span>
              </div>
            </div>
            <div className={styles.heroVisual}>
              <ProductScene copy={copy} />
            </div>
          </div>
          <div className={styles.heroTrack} aria-hidden="true"><i /><b /></div>
        </section>

        <section className={styles.proofStrip} aria-label={copy.accessibility.proof}>
          <div className={styles.proofInner}>
            {copy.proof.map((item, index) => (
              <div key={item.title}>
                <Icon name={(['cloud', 'offline', 'spark', 'shield'] as IconName[])[index]} />
                <strong>{item.title}</strong><span>{item.text}</span>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.workflowSection} id="produit">
          <div className={styles.sectionIntro} data-reveal>
            <span className={styles.sectionNumber}>{copy.workflow.eyebrow}</span>
            <h2>{copy.workflow.title[0]}<br />{copy.workflow.title[1]}</h2>
            <p>{copy.workflow.text}</p>
          </div>
          <div className={styles.workflow} data-reveal>
            <div className={styles.workflowRail} aria-hidden="true"><span /></div>
            {copy.workflow.steps.map((step, index) => (
              <article className={styles.workflowStep} key={step.title} style={{ '--step-index': index } as React.CSSProperties}>
                <div className={styles.stepMarker}>{String(index + 1).padStart(2, '0')}</div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.featureWorlds}>
          <article className={styles.featureWorld} data-reveal>
            <div className={styles.featureCopy}>
              <span className={styles.featureIndex}>{copy.features.plans.index}</span>
              <h2>{copy.features.plans.title}</h2>
              <p>{copy.features.plans.text}</p>
              <ul>
                {copy.features.plans.bullets.map(item => <li key={item}><Icon name="check" size={18} /> {item}</li>)}
              </ul>
            </div>
            <div className={styles.planShowcase} aria-label={copy.features.plans.showcaseAria}>
              <div className={styles.showcaseTop}><span>{copy.features.plans.level}</span><small>{copy.features.plans.count}</small></div>
              <svg viewBox="0 0 620 360" aria-hidden="true">
                <g className={styles.showcaseWalls}>
                  <path d="M35 35h550v285H35zM205 35v285M415 35v285M35 170h170m210 0h170M205 105h210M310 105v215" />
                  <path d="M75 72h85v56H75zM458 215h82v60h-82zM245 142h46v97h-46zM330 142h46v97h-46z" />
                </g>
              </svg>
              <span className={`${styles.issuePin} ${styles.issuePinOne}`} role="img" aria-label={copy.features.plans.pinThree}><span>3</span></span>
              <span className={`${styles.issuePin} ${styles.issuePinTwo}`} role="img" aria-label={copy.features.plans.pinEight}><span>8</span></span>
              <span className={`${styles.issuePin} ${styles.issuePinThree}`} role="img" aria-label={copy.features.plans.pinValid}><span><Icon name="check" size={16} /></span></span>
              <div className={styles.reservePopover}>
                <div className={styles.popoverHead}><span>RSV-204</span><b>{copy.features.plans.priority}</b></div>
                <strong>{copy.features.plans.issue}</strong>
                <p>{copy.features.plans.location}</p>
                <div className={styles.popoverPhoto}><Icon name="camera" /><span>{copy.features.plans.photos}</span></div>
              </div>
            </div>
          </article>

          <article className={`${styles.featureWorld} ${styles.featureWorldReverse}`} data-reveal>
            <div className={styles.fieldShowcase} aria-label={copy.features.field.showcaseAria}>
              <div className={styles.fieldHeader}>
                <div><span>{copy.features.field.date}</span><strong>{copy.features.field.liveTitle}</strong></div>
                <span className={styles.liveTag}><i /> {copy.features.field.live}</span>
              </div>
              <div className={styles.fieldColumns}>
                <div className={styles.fieldTimeline}>
                  {copy.features.field.events.map((event, index) => (
                    <div key={event[0]}><time>{['07:18', '09:42', '11:06', '14:30'][index]}</time><span><Icon name={(['team', 'camera', 'shield', 'document'] as IconName[])[index]} size={18} /></span><p><strong>{event[0]}</strong><small>{event[1]}</small></p></div>
                  ))}
                </div>
                <div className={styles.voiceCard}>
                  <span className={styles.voiceIcon}><Icon name="message" /></span>
                  <small>{copy.features.field.voice}</small>
                  <p>{copy.features.field.quote}</p>
                  <div className={styles.soundWave}>{[8,16,11,24,18,30,15,22,10,17,8].map((height, index) => <i key={index} style={{ height }} />)}</div>
                  <span className={styles.translatedNote}><Icon name="spark" size={15} /> {copy.features.field.languages}</span>
                </div>
              </div>
            </div>
            <div className={styles.featureCopy}>
              <span className={styles.featureIndex}>{copy.features.field.index}</span>
              <h2>{copy.features.field.title}</h2>
              <p>{copy.features.field.text}</p>
              <ul>
                {copy.features.field.bullets.map(item => <li key={item}><Icon name="check" size={18} /> {item}</li>)}
              </ul>
            </div>
          </article>

          <article className={styles.featureWorld} data-reveal>
            <div className={styles.featureCopy}>
              <span className={styles.featureIndex}>{copy.features.stock.index}</span>
              <h2>{copy.features.stock.title}</h2>
              <p>{copy.features.stock.text}</p>
              <ul>
                {copy.features.stock.bullets.map(item => <li key={item}><Icon name="check" size={18} /> {item}</li>)}
              </ul>
            </div>
            <div className={styles.stockShowcase} aria-label={copy.features.stock.showcaseAria}>
              <div className={styles.stockTopbar}>
                <div><span>{copy.features.stock.titleShort}</span><strong>{copy.features.stock.location}</strong></div>
                <span className={styles.stockScanButton}><Icon name="scan" size={18} /> {copy.features.stock.scan}</span>
              </div>
              <div className={styles.stockAlert}><Icon name="box" size={19} /><span><strong>{copy.features.stock.alert}</strong> · {copy.features.stock.alertDetail}</span><Icon name="chevron" size={17} /></div>
              <div className={styles.stockTable}>
                <div className={styles.stockTableHead}>{copy.features.stock.columns.map(column => <span key={column}>{column}</span>)}</div>
                {copy.features.stock.rows.map((row, index) => <div key={row[0]}><span>{row[0]}</span><span>{row[1]}</span><strong>{row[2]}</strong><b className={index === 1 ? styles.statusLow : styles.statusGood}>{row[3]}</b></div>)}
              </div>
              <div className={styles.stockMovement}>
                <span className={styles.movementIcon}><Icon name="download" size={18} /></span>
                <div><small>{copy.features.stock.last}</small><strong>{copy.features.stock.movement}</strong></div>
                <time>14:32</time>
              </div>
            </div>
          </article>
        </section>

        <section id="modules" className={styles.advancedSection}>
          <div className={styles.advancedIntro} data-reveal>
            <span className={styles.sectionNumber}>{copy.advanced.eyebrow}</span>
            <h2>{copy.advanced.title}</h2>
            <p>{copy.advanced.text}</p>
          </div>
          <div className={styles.advancedWorkbench} data-reveal>
            <div className={styles.moduleRail}>
              {copy.advanced.modules.map((module, index) => (
                <div className={styles.moduleRow} key={module[0]}>
                  <span className={styles.moduleIcon}><Icon name={(['plan', 'message', 'check', 'history', 'document', 'shield'] as IconName[])[index]} /></span>
                  <div><strong>{module[0]}</strong><p>{module[1]}</p></div>
                  <span className={styles.moduleNumber}>{String(index + 1).padStart(2, '0')}</span>
                </div>
              ))}
            </div>
            <div className={styles.activityFeed}>
              <div className={styles.activityFeedHeader}>
                <div><small>BuildTrack</small><strong>{copy.advanced.feedTitle}</strong></div>
                <span><i /> {copy.advanced.feedStatus}</span>
              </div>
              <div className={styles.activityProject}>
                <span className={styles.activityProjectMark}><Icon name="hardhat" size={19} /></span>
                <div><small>{copy.mock.project}</small><strong>{copy.mock.level}</strong></div>
                <Icon name="chevron" size={18} />
              </div>
              <div className={styles.feedTimeline}>
                {copy.advanced.feed.map((event, index) => (
                  <div key={event[0]}>
                    <span><Icon name={(['camera', 'check', 'message', 'document'] as IconName[])[index]} size={17} /></span>
                    <p><strong>{event[0]}</strong><small>{event[1]}</small></p>
                    <time>{['09:42', '11:18', '13:05', '16:24'][index]}</time>
                  </div>
                ))}
              </div>
              <a href="#demo">{copy.advanced.link} <Icon name="arrow" size={18} /></a>
            </div>
          </div>
        </section>

        <section className={styles.rolesSection} id="metiers">
          <div className={styles.sectionIntro} data-reveal>
            <span className={styles.sectionNumber}>{copy.roles.eyebrow}</span>
            <h2>{copy.roles.title}</h2>
            <p>{copy.roles.text}</p>
          </div>
          <div className={styles.roleExperience} data-reveal>
            <div className={styles.roleSelector} role="tablist" aria-label={copy.roles.tabLabel}>
              {(Object.keys(roleContent) as RoleKey[]).map(key => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={activeRole === key}
                  aria-controls="role-panel"
                  className={activeRole === key ? styles.roleButtonActive : ''}
                  onClick={() => setActiveRole(key)}
                >
                  <span>{roleContent[key].label}</span><Icon name="arrow" size={18} />
                </button>
              ))}
            </div>
            <div className={styles.rolePanel} id="role-panel" role="tabpanel">
              <div className={styles.rolePanelCopy}>
                <span>{role.accent}</span>
                <h3>{role.title}</h3>
                <p>{role.text}</p>
                <a href="#demo">{copy.roles.demoLink} <Icon name="arrow" size={18} /></a>
              </div>
              <div className={styles.roleDashboard}>
                <div className={styles.roleDashHeader}><Brand compact /><span>{role.accent}</span><div className={styles.roleAvatar}>{role.label.slice(0, 1)}</div></div>
                <div className={styles.roleStat}><small>{copy.roles.today}</small><strong>{role.stat}</strong><span>{role.statLabel}</span><i><b /></i></div>
                <div className={styles.roleList}>
                  {role.items.map((item, index) => (
                    <div key={item}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item}</strong><Icon name="chevron" size={17} /></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.reliabilitySection} id="fiabilite">
          <div className={styles.reliabilityGrid}>
            <div className={styles.reliabilityCopy} data-reveal>
              <span className={styles.sectionNumberLight}>{copy.reliability.eyebrow}</span>
              <h2>{copy.reliability.title}</h2>
              <p>{copy.reliability.text}</p>
              <div className={styles.reliabilityPoints}>
                {copy.reliability.points.map((point, index) => <div key={point[0]}><span><Icon name={(['offline', 'cloud', 'lock'] as IconName[])[index]} /></span><p><strong>{point[0]}</strong><small>{point[1]}</small></p></div>)}
              </div>
            </div>
            <div className={styles.syncVisual} data-reveal aria-label={copy.reliability.showcaseAria}>
              <div className={styles.syncOrbit}><i /><i /><i /></div>
              <div className={styles.syncDevice}>
                <div className={styles.syncDeviceTop}><span /><strong>{copy.reliability.terrain}</strong><Icon name="offline" size={18} /></div>
                <div className={styles.syncQueue}>
                  {copy.reliability.queue.map((item, index) => <div key={item[0]}><span><Icon name={(['camera', 'check', 'document'] as IconName[])[index]} size={17} /></span><p><strong>{item[0]}</strong><small>{item[1]}</small></p><b>{copy.reliability.ready}</b></div>)}
                </div>
              </div>
              <div className={styles.syncCloud}><Icon name="cloud" size={32} /><strong>{copy.reliability.connected}</strong><span>{copy.reliability.synced}</span></div>
              <svg className={styles.syncPath} viewBox="0 0 560 390" aria-hidden="true"><path d="M215 305C360 315 340 90 465 105" /></svg>
            </div>
          </div>
        </section>

        <section className={styles.capabilitiesSection}>
          <div className={styles.capabilitiesHeading} data-reveal>
            <div><span className={styles.sectionNumber}>{copy.capabilities.eyebrow}</span><h2>{copy.capabilities.title[0]}<br />{copy.capabilities.title[1]}</h2></div>
            <p>{copy.capabilities.text}</p>
          </div>
          <div className={styles.capabilityGrid} data-reveal>
            {copy.capabilities.groups.map((group, groupIndex) => (
              <div className={styles.capabilityColumn} key={group[0]}>
                <span className={styles.capabilityNumber}>{String(groupIndex + 1).padStart(2, '0')}</span>
                <h3>{group[0]}</h3>
                <ul>{group.slice(1).map(item => <li key={item}><Icon name="check" size={16} /> {item}</li>)}</ul>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.faqSection} id="faq">
          <div className={styles.faqIntro} data-reveal>
            <span className={styles.sectionNumber}>{copy.faq.eyebrow}</span>
            <h2>{copy.faq.title}</h2>
            <p>{copy.faq.text}</p>
          </div>
          <div className={styles.faqList} data-reveal>
            {copy.faq.items.map(item => (
              <details key={item[0]}>
                <summary aria-label={item[0]}>{item[0]} <span aria-hidden="true"><Icon name="chevron" /></span></summary>
                <p>{item[1]}</p>
              </details>
            ))}
          </div>
        </section>

        <section className={styles.demoSection} id="demo">
          <div className={styles.demoShell} data-reveal>
            <div className={styles.demoCopy}>
              <span>{copy.demo.eyebrow}</span>
              <h2>{copy.demo.title}</h2>
              <p>{copy.demo.text}</p>
              <div className={styles.demoPromise}>
                {copy.demo.promises.map((promise, index) => <div key={promise[0]}><Icon name={(['hardhat', 'plan', 'company'] as IconName[])[index]} /><span><strong>{promise[0]}</strong><small>{promise[1]}</small></span></div>)}
              </div>
            </div>
            <form className={styles.demoForm} onSubmit={submitDemoRequest}>
              <div className={styles.formHeading}><strong>{copy.demo.formTitle}</strong><span>{copy.demo.required}</span></div>
              <input name="language" type="hidden" value={language} />
              <div className={styles.honeypot} aria-hidden="true">
                <label htmlFor="website">{copy.demo.honeypot}</label><input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
              </div>
              <div className={styles.formRow}>
                <label>{copy.demo.name}<input name="name" type="text" autoComplete="name" required maxLength={100} placeholder={copy.demo.namePlaceholder} /></label>
                <label>{copy.demo.company}<input name="company" type="text" autoComplete="organization" required maxLength={120} placeholder={copy.demo.companyPlaceholder} /></label>
              </div>
              <div className={styles.formRow}>
                <label>{copy.demo.email}<input name="email" type="email" autoComplete="email" required maxLength={160} placeholder={copy.demo.emailPlaceholder} /></label>
                <label>{copy.demo.phone}<input name="phone" type="tel" autoComplete="tel" maxLength={40} placeholder={copy.demo.phonePlaceholder} /></label>
              </div>
              <label>{copy.demo.team}<select name="teamSize" defaultValue="">
                <option value="" disabled>{copy.demo.teamPlaceholder}</option>
                {copy.demo.teamOptions.map((option, index) => <option key={option} value={['1-10', '11-50', '51-200', '201+'][index]}>{option}</option>)}
              </select></label>
              <label>{copy.demo.need}<textarea name="message" maxLength={1500} rows={4} placeholder={copy.demo.needPlaceholder} /></label>
              <button className={styles.submitButton} type="submit" disabled={formState === 'sending'}>
                {formState === 'sending' ? copy.demo.sending : copy.demo.submit}
                {formState !== 'sending' && <Icon name="arrow" />}
              </button>
              <p className={styles.formLegal}>{copy.demo.legal}</p>
              {formMessage && <p className={`${styles.formStatus} ${formState === 'error' ? styles.formStatusError : ''}`} role="status">{formMessage}</p>}
            </form>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerMain}>
          <div><Brand /><p>{copy.footer.tagline}</p></div>
          <div><strong>{copy.footer.platform}</strong><a href="#produit">{copy.nav.product}</a><a href="#metiers">{copy.nav.roles}</a><a href="#fiabilite">{copy.nav.reliability}</a></div>
          <div><strong>{copy.footer.access}</strong><a href="/web">{copy.nav.login}</a><a href="#demo">{copy.nav.demo}</a><a href="mailto:buildtrack.admin@gmail.com">{copy.footer.write}</a></div>
        </div>
        <div className={styles.footerBottom}><span>© {new Date().getFullYear()} BuildTrack</span><span>{copy.footer.baseline}</span></div>
      </footer>
    </div>
  );
}
