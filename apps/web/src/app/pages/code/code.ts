import { Clipboard } from '@angular/cdk/clipboard';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Seo } from '../../seo/seo';
import { languageFor } from './languages';

interface CodeTree {
  ref: string;
  commit: string | null;
  path: string;
  editor: boolean;
  empty?: boolean;
  entries: { name: string; type: 'tree' | 'blob' | 'link' }[];
}
interface CodeFile {
  path: string;
  size: number;
  binary: boolean;
  tooLarge: boolean;
  text: string | null;
}

/**
 * Read-only code browser. The published version for everyone; any branch for owners and
 * members. Highlighting runs in the browser with Shiki, loaded (with each language) on demand.
 */
@Component({
  selector: 'app-code',
  imports: [MatButtonModule, MatFormFieldModule, MatIconModule, MatListModule, MatProgressBarModule, MatSelectModule, RouterLink],
  templateUrl: './code.html',
  styleUrl: './code.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodePage {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly clipboard = inject(Clipboard);
  private readonly snackBar = inject(MatSnackBar);
  private readonly route = inject(ActivatedRoute);
  protected readonly owner = this.route.snapshot.paramMap.get('owner') ?? '';
  protected readonly slug = this.route.snapshot.paramMap.get('slug') ?? '';
  protected readonly full = `${this.owner}/${this.slug}`;
  private readonly query = toSignal(this.route.queryParamMap, { requireSync: true });
  /** Directory shown (the file's directory when a file is open). */
  protected readonly dir = computed(() => this.query().get('path') ?? '');
  protected readonly file = computed(() => this.query().get('file'));
  protected readonly ref = computed(() => this.query().get('ref'));

  protected readonly tree = signal<CodeTree | null | undefined>(undefined);
  protected readonly blob = signal<CodeFile | null>(null);
  protected readonly html = signal<SafeHtml | null>(null);
  protected readonly loading = signal(false);
  protected readonly branches = signal<string[]>([]);
  protected readonly crumbs = computed(() => {
    const parts = (this.file() ?? this.dir()).split('/').filter(Boolean);
    return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/'), last: i === parts.length - 1 }));
  });

  constructor() {
    inject(Seo).set({ title: `Code · ${this.full}`, description: `Source code of ${this.full}.`, path: `/${this.full}/code`, noindex: true });
    this.route.queryParamMap.subscribe(() => void this.load());
  }

  protected params(extra: Record<string, string | null>): Record<string, string | null> {
    return { ref: this.ref(), ...extra };
  }

  protected entryParams(name: string, type: string): Record<string, string | null> {
    const path = [this.dir(), name].filter(Boolean).join('/');
    return type === 'tree' ? this.params({ path, file: null }) : this.params({ path: this.dir() || null, file: path });
  }

  protected isOpen(name: string): boolean {
    return this.file() === [this.dir(), name].filter(Boolean).join('/');
  }

  protected chooseRef(ref: string): void {
    void this.router.navigate([], { queryParams: { ref, path: null, file: null } });
  }

  protected copy(): void {
    const text = this.blob()?.text;
    if (text) this.snackBar.open(this.clipboard.copy(text) ? 'Copied' : 'Copy failed', undefined, { duration: 2000 });
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    const ref = this.ref();
    const base = `/api/repos/${this.full}/code`;
    const refParam: Record<string, string> = ref ? { ref } : {};
    try {
      const tree = await firstValueFrom(this.http.get<CodeTree>(`${base}/tree`, { params: { ...refParam, path: this.dir() } })).catch(() => null);
      this.tree.set(tree);
      if (tree?.editor && !this.branches().length) {
        const b = await firstValueFrom(this.http.get<{ branches: string[] }>(`${base}/branches`)).catch(() => ({ branches: [] }));
        this.branches.set(b.branches);
      }
      const file = this.file();
      this.html.set(null);
      this.blob.set(null);
      if (file) {
        const blob = await firstValueFrom(this.http.get<CodeFile>(`${base}/blob`, { params: { ...refParam, path: file } })).catch(() => null);
        this.blob.set(blob);
        if (blob?.text != null) this.html.set(await this.highlight(blob.text, file));
      }
    } finally {
      this.loading.set(false);
    }
  }

  private async highlight(text: string, path: string): Promise<SafeHtml> {
    const { codeToHtml } = await import('shiki');
    let html: string;
    try {
      html = await codeToHtml(text, { lang: languageFor(path), theme: 'github-light' });
    } catch {
      html = await codeToHtml(text, { lang: 'text', theme: 'github-light' });
    }
    // Shiki escapes the code; its markup is safe to insert.
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }
}
