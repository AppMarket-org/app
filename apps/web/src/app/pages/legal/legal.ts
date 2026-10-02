import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute } from '@angular/router';
import { Markdown } from '../../components/markdown/markdown';
import { Seo } from '../../seo/seo';
import { CONTENT_POLICY } from './content/content-policy';
import { DEVELOPER_AGREEMENT } from './content/developer-agreement';
import { PRIVACY } from './content/privacy';
import { TERMS } from './content/terms';

const PAGES: Record<string, { title: string; description: string; markdown: string }> = {
  terms: { title: 'Terms of service', description: 'The terms for using appmarket.org.', markdown: TERMS },
  'developer-agreement': { title: 'Developer agreement', description: 'The agreement for publishing apps on appmarket.org.', markdown: DEVELOPER_AGREEMENT },
  'content-policy': { title: 'Content policy', description: 'What apps and content are allowed on appmarket.org.', markdown: CONTENT_POLICY },
  privacy: { title: 'Privacy', description: 'What appmarket.org collects and why.', markdown: PRIVACY },
};

/**
 * PRD R21: legal pages, prerendered. DRAFTS: bracketed placeholders (entity, jurisdiction, contact,
 * retention, liability) must be filled and the text reviewed by counsel before launch (#24).
 */
@Component({
  selector: 'app-legal',
  imports: [MatCardModule, MatIconModule, Markdown],
  templateUrl: './legal.html',
  styleUrl: './legal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Legal {
  protected readonly page = PAGES[inject(ActivatedRoute).snapshot.paramMap.get('page') ?? ''] ?? null;

  constructor() {
    const slug = inject(ActivatedRoute).snapshot.paramMap.get('page') ?? '';
    inject(Seo).set(
      this.page
        ? { title: this.page.title, description: this.page.description, path: `/legal/${slug}` }
        : { title: 'Page not found', description: 'This page does not exist.', path: `/legal/${slug}`, noindex: true },
    );
  }
}
