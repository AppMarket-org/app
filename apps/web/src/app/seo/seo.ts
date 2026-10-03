import { DOCUMENT, Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

export interface PageSeo {
  title: string;
  description: string;
  /** Path only, for example `/apps/my-app`. */
  path: string;
  image?: string;
  noindex?: boolean;
  /** schema.org object, for example a SoftwareApplication for a repo. */
  jsonLd?: Record<string, unknown>;
}

const ORIGIN = 'https://appmarket.org';

/** Sets title, description, canonical, Open Graph, Twitter and JSON-LD tags; rendered into server HTML. */
@Injectable({ providedIn: 'root' })
export class Seo {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);

  set(page: PageSeo): void {
    const url = ORIGIN + page.path;
    this.title.setTitle(`${page.title} | appmarket.org`);
    this.meta.updateTag({ name: 'description', content: page.description });
    this.meta.updateTag({ name: 'robots', content: page.noindex ? 'noindex, nofollow' : 'index, follow' });
    this.meta.updateTag({ property: 'og:title', content: page.title });
    this.meta.updateTag({ property: 'og:description', content: page.description });
    this.meta.updateTag({ property: 'og:url', content: url });
    this.meta.updateTag({ property: 'og:type', content: 'website' });
    if (page.image) {
      this.meta.updateTag({ property: 'og:image', content: page.image });
    }
    this.meta.updateTag({ name: 'twitter:card', content: page.image ? 'summary_large_image' : 'summary' });
    this.setLink('canonical', url);
    this.setJsonLd(page.jsonLd);
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
