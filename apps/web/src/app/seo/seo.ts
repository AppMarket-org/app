import { DOCUMENT, Injectable, inject, signal } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

export interface PageSeo {
  title: string;
  description: string;
  /** Path only, for example `/acme/my-app`. */
  path: string;
  image?: string;
  noindex?: boolean;
  /** schema.org object, for example a SoftwareApplication for a repo. */
  jsonLd?: Record<string, unknown>;
  /** Header title next to the logo, GitHub-style (`owner / app`). Defaults to the title; [] for none. */
  heading?: HeadingPart[];
}

export interface HeadingPart {
  label: string;
  /** Router link; plain text when absent. */
  link?: string;
}

const ORIGIN = 'https://appmarket.org';
const DEFAULT_CARD = '/api/og/home.png';
const absolute = (url: string) => (url.startsWith('/') ? ORIGIN + url : url);

/** Sets title, description, canonical, Open Graph, Twitter and JSON-LD tags; rendered into server HTML. */
@Injectable({ providedIn: 'root' })
export class Seo {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);

  /** What the toolbar shows next to the logo. */
  readonly heading = signal<HeadingPart[]>([]);

  set(page: PageSeo): void {
    this.heading.set(page.heading ?? [{ label: page.title }]);
    const url = ORIGIN + page.path;
    this.title.setTitle(`${page.title} | appmarket.org`);
    this.meta.updateTag({ name: 'description', content: page.description });
    this.meta.updateTag({ name: 'robots', content: page.noindex ? 'noindex, nofollow' : 'index, follow' });
    this.meta.updateTag({ property: 'og:title', content: page.title });
    this.meta.updateTag({ property: 'og:description', content: page.description });
    this.meta.updateTag({ property: 'og:url', content: url });
    this.meta.updateTag({ property: 'og:type', content: 'website' });
    // Social preview cards: generated 1200×630 images (/api/og/…); pages without their own use the site card.
    const image = page.noindex ? undefined : (page.image ?? DEFAULT_CARD);
    const card = !!image && /\/api\/og\//.test(image);
    for (const [property, content] of [
      ['og:image', image],
      ['og:image:width', card ? '1200' : undefined],
      ['og:image:height', card ? '630' : undefined],
      ['og:image:alt', image ? page.title : undefined],
    ] as const) {
      if (content) this.meta.updateTag({ property, content: property === 'og:image' ? absolute(content) : content });
      else this.meta.removeTag(`property="${property}"`);
    }
    this.meta.updateTag({ name: 'twitter:card', content: card ? 'summary_large_image' : 'summary' });
    if (image) this.meta.updateTag({ name: 'twitter:image', content: absolute(image) });
    else this.meta.removeTag('name="twitter:image"');
    this.setLink('canonical', url);
    this.setJsonLd(page.jsonLd);
  }

  /** Updates only the toolbar heading, for pages that know their subject after loading. */
  setHeading(parts: HeadingPart[]): void {
    this.heading.set(parts);
  }

  private setLink(rel: string, href: string): void {
    let link = this.document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
    if (!link) {
      link = this.document.createElement('link');
      link.rel = rel;
      this.document.head.appendChild(link);
    }
    link.href = href;
  }

  private setJsonLd(data?: Record<string, unknown>): void {
    this.document.head.querySelector('script[data-seo="jsonld"]')?.remove();
    if (!data) return;
    const script = this.document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute('data-seo', 'jsonld');
    script.textContent = JSON.stringify({ '@context': 'https://schema.org', ...data });
    this.document.head.appendChild(script);
  }
}
